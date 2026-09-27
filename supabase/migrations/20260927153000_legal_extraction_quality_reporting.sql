-- Admin-only quality reporting for candidate legal extraction.
-- The functions expose aggregate quality signals, not candidate body text or evidence text.

create or replace function public.get_legal_extraction_quality_summary()
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
    'ingestion_jobs', jsonb_build_object(
      'extract_legal', coalesce((
        select jsonb_object_agg(status, job_count order by status)
        from (
          select status, count(*) as job_count
          from public.ingestion_jobs
          where job_type = 'extract_legal'
          group by status
        ) jobs
      ), '{}'::jsonb),
      'extract_tariff', coalesce((
        select jsonb_object_agg(status, job_count order by status)
        from (
          select status, count(*) as job_count
          from public.ingestion_jobs
          where job_type = 'extract_tariff'
          group by status
        ) jobs
      ), '{}'::jsonb),
      'ocr_page', coalesce((
        select jsonb_object_agg(status, job_count order by status)
        from (
          select status, count(*) as job_count
          from public.ingestion_jobs
          where job_type = 'ocr_page'
          group by status
        ) jobs
      ), '{}'::jsonb)
    ),
    'legal_extraction_runs', jsonb_build_object(
      'total', (select count(*) from public.legal_extraction_runs),
      'by_status', coalesce((
        select jsonb_object_agg(status, run_count order by status)
        from (
          select status, count(*) as run_count
          from public.legal_extraction_runs
          group by status
        ) runs
      ), '{}'::jsonb),
      'quality_score', coalesce((
        select jsonb_build_object(
          'average', round(avg(quality_score)::numeric, 2),
          'minimum', min(quality_score),
          'maximum', max(quality_score)
        )
        from public.legal_extraction_runs
      ), jsonb_build_object('average', null, 'minimum', null, 'maximum', null))
    ),
    'legal_provision_candidates', jsonb_build_object(
      'total', (select count(*) from public.legal_provision_candidates),
      'by_type', coalesce((
        select jsonb_object_agg(provision_type, candidate_count order by provision_type)
        from (
          select provision_type, count(*) as candidate_count
          from public.legal_provision_candidates
          group by provision_type
        ) provisions
      ), '{}'::jsonb),
      'by_validation_status', coalesce((
        select jsonb_object_agg(validation_status, candidate_count order by validation_status)
        from (
          select validation_status, count(*) as candidate_count
          from public.legal_provision_candidates
          group by validation_status
        ) provisions
      ), '{}'::jsonb),
      'by_publication_status', coalesce((
        select jsonb_object_agg(publication_status, candidate_count order by publication_status)
        from (
          select publication_status, count(*) as candidate_count
          from public.legal_provision_candidates
          group by publication_status
        ) provisions
      ), '{}'::jsonb)
    ),
    'legal_relationship_candidates', jsonb_build_object(
      'total', (select count(*) from public.legal_relationship_candidates),
      'by_type', coalesce((
        select jsonb_object_agg(relationship_type, candidate_count order by relationship_type)
        from (
          select relationship_type, count(*) as candidate_count
          from public.legal_relationship_candidates
          group by relationship_type
        ) relationships
      ), '{}'::jsonb),
      'by_validation_status', coalesce((
        select jsonb_object_agg(validation_status, candidate_count order by validation_status)
        from (
          select validation_status, count(*) as candidate_count
          from public.legal_relationship_candidates
          group by validation_status
        ) relationships
      ), '{}'::jsonb),
      'by_publication_status', coalesce((
        select jsonb_object_agg(publication_status, candidate_count order by publication_status)
        from (
          select publication_status, count(*) as candidate_count
          from public.legal_relationship_candidates
          group by publication_status
        ) relationships
      ), '{}'::jsonb)
    ),
    'canonical_legal_facts', jsonb_build_object(
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

create or replace function public.list_legal_extraction_quality_runs(
  p_status text default null,
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
  issue_reason text,
  provision_types jsonb,
  relationship_types jsonb,
  created_at timestamptz
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

  if p_status is not null and p_status not in ('completed','review_required','rejected','failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return query
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
    case
      when r.status = 'rejected' and r.provision_count = 0 then 'no_provisions_detected'
      when r.status = 'rejected' and r.article_count = 0 then 'no_articles_detected'
      when r.status = 'review_required' and r.article_count = 0 then 'hierarchy_without_articles'
      when r.status = 'review_required' then 'candidate_quality_review_required'
      when r.status = 'completed' then 'candidate_pass_has_articles'
      else r.status
    end as issue_reason,
    coalesce(provisions.by_type, '{}'::jsonb) as provision_types,
    coalesce(relationships.by_type, '{}'::jsonb) as relationship_types,
    r.created_at
  from public.legal_extraction_runs r
  join public.source_documents d on d.id = r.source_document_id
  left join lateral (
    select jsonb_object_agg(provision_type, candidate_count order by provision_type) as by_type
    from (
      select provision_type, count(*) as candidate_count
      from public.legal_provision_candidates p
      where p.extraction_run_id = r.id
      group by provision_type
    ) grouped
  ) provisions on true
  left join lateral (
    select jsonb_object_agg(relationship_type, candidate_count order by relationship_type) as by_type
    from (
      select relationship_type, count(*) as candidate_count
      from public.legal_relationship_candidates rc
      where rc.extraction_run_id = r.id
      group by relationship_type
    ) grouped
  ) relationships on true
  where p_status is null or r.status = p_status
  order by
    case r.status
      when 'rejected' then 1
      when 'review_required' then 2
      when 'failed' then 3
      when 'completed' then 4
      else 5
    end,
    r.quality_score nulls first,
    r.created_at desc
  limit safe_limit;
end;
$$;

revoke all on function public.get_legal_extraction_quality_summary() from public, anon, authenticated;
revoke all on function public.list_legal_extraction_quality_runs(text, integer) from public, anon, authenticated;
grant execute on function public.get_legal_extraction_quality_summary() to authenticated;
grant execute on function public.list_legal_extraction_quality_runs(text, integer) to authenticated;

comment on function public.get_legal_extraction_quality_summary() is 'Admin-only aggregate quality report for unpublished legal extraction candidates. Does not expose legal body text.';
comment on function public.list_legal_extraction_quality_runs(text, integer) is 'Admin-only legal extraction run list with quality status and candidate counts. Does not expose legal body text.';
