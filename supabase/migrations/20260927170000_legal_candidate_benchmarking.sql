-- Admin-only benchmark helpers for legal candidate quality.
-- These functions measure extraction candidates before canonical promotion.
-- They do not publish legal facts and do not expose full candidate body text.

create or replace function public.get_legal_candidate_benchmark()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'measured_at', now(),
    'run_status', coalesce((
      select jsonb_object_agg(status, run_count order by status)
      from (
        select status, count(*) as run_count
        from public.legal_extraction_runs
        group by status
      ) s
    ), '{}'::jsonb),
    'provision_quality_bands', coalesce((
      select jsonb_object_agg(quality_band, candidate_count order by quality_band)
      from (
        select
          case
            when extraction_confidence >= 90 then '90_100_strong'
            when extraction_confidence >= 75 then '75_89_good'
            when extraction_confidence >= 60 then '60_74_review'
            else 'below_60_weak'
          end as quality_band,
          count(*) as candidate_count
        from public.legal_provision_candidates
        group by 1
      ) bands
    ), '{}'::jsonb),
    'relationship_quality_bands', coalesce((
      select jsonb_object_agg(quality_band, candidate_count order by quality_band)
      from (
        select
          case
            when confidence >= 90 then '90_100_strong'
            when confidence >= 75 then '75_89_good'
            when confidence >= 60 then '60_74_review'
            else 'below_60_weak'
          end as quality_band,
          count(*) as candidate_count
        from public.legal_relationship_candidates
        group by 1
      ) bands
    ), '{}'::jsonb),
    'provisions_by_type_and_source', coalesce((
      select jsonb_agg(row_to_json(grouped) order by provision_type, extraction_mode)
      from (
        select
          provision_type,
          coalesce(metadata->>'extraction_mode', 'unknown') as extraction_mode,
          count(*) as candidates,
          count(distinct extraction_run_id) as runs,
          round(avg(extraction_confidence), 2) as avg_confidence
        from public.legal_provision_candidates
        group by provision_type, coalesce(metadata->>'extraction_mode', 'unknown')
      ) grouped
    ), '[]'::jsonb),
    'relationships_by_type', coalesce((
      select jsonb_agg(row_to_json(grouped) order by relationship_type)
      from (
        select
          relationship_type,
          count(*) as candidates,
          count(distinct extraction_run_id) as runs,
          round(avg(confidence), 2) as avg_confidence
        from public.legal_relationship_candidates
        group by relationship_type
      ) grouped
    ), '[]'::jsonb),
    'potential_promotion_pool', jsonb_build_object(
      'runs_completed', (select count(*) from public.legal_extraction_runs where status = 'completed'),
      'article_candidates_90_plus', (select count(*) from public.legal_provision_candidates where provision_type = 'article' and extraction_confidence >= 90),
      'fallback_candidates_70_plus', (select count(*) from public.legal_provision_candidates where metadata->>'extraction_mode' = 'postgres_circular_fallback_v1' and extraction_confidence >= 70),
      'relationships_75_plus', (select count(*) from public.legal_relationship_candidates where confidence >= 75),
      'runs_review_required_with_10_plus_provisions', (
        select count(*)
        from public.legal_extraction_runs
        where status = 'review_required' and provision_count >= 10
      )
    ),
    'canonical_publication_state', jsonb_build_object(
      'legal_instruments', (select count(*) from public.legal_instruments),
      'legal_versions', (select count(*) from public.legal_versions),
      'legal_provisions', (select count(*) from public.legal_provisions),
      'legal_relationships', (select count(*) from public.legal_relationships),
      'regulatory_measures', (select count(*) from public.regulatory_measures)
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.list_legal_candidate_benchmark_runs(
  p_limit integer default 100
)
returns table(
  source_document_id uuid,
  title text,
  official_reference text,
  document_type text,
  run_id uuid,
  run_status text,
  quality_score numeric,
  provision_count integer,
  article_count integer,
  relationship_count integer,
  fallback_count integer,
  strong_article_count integer,
  strong_relationship_count integer,
  benchmark_bucket text,
  recommended_next_action text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  return query
  with scored as (
    select
      d.id as source_document_id,
      d.title,
      d.official_reference,
      d.document_type,
      r.id as run_id,
      r.status as run_status,
      r.quality_score,
      r.provision_count,
      r.article_count,
      r.relationship_count,
      coalesce(p.fallback_count, 0)::integer as fallback_count,
      coalesce(p.strong_article_count, 0)::integer as strong_article_count,
      coalesce(rel.strong_relationship_count, 0)::integer as strong_relationship_count
    from public.legal_extraction_runs r
    join public.source_documents d on d.id = r.source_document_id
    left join lateral (
      select
        count(*) filter (where metadata->>'extraction_mode' = 'postgres_circular_fallback_v1') as fallback_count,
        count(*) filter (where provision_type = 'article' and extraction_confidence >= 90) as strong_article_count
      from public.legal_provision_candidates p
      where p.extraction_run_id = r.id
    ) p on true
    left join lateral (
      select count(*) filter (where confidence >= 75) as strong_relationship_count
      from public.legal_relationship_candidates rc
      where rc.extraction_run_id = r.id
    ) rel on true
  )
  select
    scored.source_document_id,
    scored.title,
    scored.official_reference,
    scored.document_type,
    scored.run_id,
    scored.run_status,
    scored.quality_score,
    scored.provision_count,
    scored.article_count,
    scored.relationship_count,
    scored.fallback_count,
    scored.strong_article_count,
    scored.strong_relationship_count,
    case
      when scored.run_status = 'completed' and scored.strong_article_count >= 1 then 'promotion_candidate_article_based'
      when scored.run_status = 'review_required' and scored.fallback_count >= 10 and scored.relationship_count >= 1 then 'review_candidate_circular_context'
      when scored.run_status = 'review_required' and scored.provision_count >= 10 then 'review_candidate_structure_only'
      when scored.run_status = 'rejected' and scored.provision_count between 1 and 2 then 'weak_candidate_insufficient_context'
      when scored.run_status = 'rejected' then 'no_exploitable_candidate'
      else 'manual_review'
    end as benchmark_bucket,
    case
      when scored.run_status = 'completed' and scored.strong_article_count >= 1 then 'sample_for_canonical_promotion_rules'
      when scored.run_status = 'review_required' and scored.fallback_count >= 10 and scored.relationship_count >= 1 then 'review_fallback_paragraphs_and_relationships'
      when scored.run_status = 'review_required' and scored.provision_count >= 10 then 'review_structure_without_relationships'
      when scored.run_status = 'rejected' and scored.provision_count between 1 and 2 then 'tighten_or_discard_low_signal_candidates'
      when scored.run_status = 'rejected' then 'inspect_source_text_or_ocr_need'
      else 'manual_review'
    end as recommended_next_action
  from scored
  order by
    case
      when scored.run_status = 'completed' then 1
      when scored.run_status = 'review_required' and scored.fallback_count >= 10 and scored.relationship_count >= 1 then 2
      when scored.run_status = 'review_required' then 3
      when scored.run_status = 'rejected' and scored.provision_count between 1 and 2 then 4
      else 5
    end,
    scored.quality_score desc nulls last,
    scored.provision_count desc,
    scored.relationship_count desc
  limit safe_limit;
end;
$$;

revoke all on function public.get_legal_candidate_benchmark() from public, anon, authenticated;
revoke all on function public.list_legal_candidate_benchmark_runs(integer) from public, anon, authenticated;
grant execute on function public.get_legal_candidate_benchmark() to authenticated;
grant execute on function public.list_legal_candidate_benchmark_runs(integer) to authenticated;

comment on function public.get_legal_candidate_benchmark() is 'Admin-only aggregate benchmark of unpublished legal extraction candidates before canonical promotion.';
comment on function public.list_legal_candidate_benchmark_runs(integer) is 'Admin-only ranked benchmark list of legal extraction runs and recommended next action. No candidate body text is returned.';
