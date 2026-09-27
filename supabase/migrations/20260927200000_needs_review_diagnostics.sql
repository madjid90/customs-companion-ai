-- Diagnostics for legal provisions that remain in needs_review.
-- This identifies whether the issue is extraction quality, scoring, hierarchy, or conservative thresholds.

create or replace function public.get_legal_needs_review_diagnostics(target_version_id uuid)
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

  if not exists (select 1 from public.legal_versions where id = target_version_id) then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  with provisions as (
    select
      p.*,
      length(btrim(coalesce(p.body_text, ''))) as body_length,
      parent.review_status as parent_review_status,
      parent.provision_type as parent_type
    from public.legal_provisions p
    left join public.legal_provisions parent
      on parent.legal_version_id = p.legal_version_id
     and parent.hierarchy_path = regexp_replace(p.hierarchy_path, '/[^/]+$', '')
    where p.legal_version_id = target_version_id
  ), needs as (
    select * from provisions where review_status = 'needs_review'
  )
  select jsonb_build_object(
    'version_id', target_version_id,
    'totals', jsonb_build_object(
      'all_provisions', (select count(*) from provisions),
      'needs_review', (select count(*) from needs),
      'validated', (select count(*) from provisions where review_status = 'validated'),
      'rejected', (select count(*) from provisions where review_status = 'rejected')
    ),
    'needs_review_by_type', coalesce((
      select jsonb_object_agg(provision_type, row_to_json(grouped) order by provision_type)
      from (
        select
          provision_type,
          count(*) as count,
          round(avg(extraction_confidence), 2) as avg_confidence,
          min(extraction_confidence) as min_confidence,
          max(extraction_confidence) as max_confidence,
          round(avg(body_length), 2) as avg_body_length
        from needs
        group by provision_type
      ) grouped
    ), '{}'::jsonb),
    'needs_review_confidence_bands', coalesce((
      select jsonb_object_agg(confidence_band, count order by confidence_band)
      from (
        select
          case
            when extraction_confidence >= 90 then '90_100_high'
            when extraction_confidence >= 80 then '80_89_good'
            when extraction_confidence >= 70 then '70_79_medium'
            when extraction_confidence >= 60 then '60_69_low'
            when extraction_confidence >= 50 then '50_59_weak'
            else 'below_50_bad'
          end as confidence_band,
          count(*) as count
        from needs
        group by 1
      ) grouped
    ), '{}'::jsonb),
    'needs_review_length_bands', coalesce((
      select jsonb_object_agg(length_band, count order by length_band)
      from (
        select
          case
            when body_length < 20 then 'lt_20_too_short'
            when body_length < 80 then '20_79_short'
            when body_length < 500 then '80_499_normal'
            when body_length < 2000 then '500_1999_long'
            else 'gte_2000_very_long'
          end as length_band,
          count(*) as count
        from needs
        group by 1
      ) grouped
    ), '{}'::jsonb),
    'needs_review_parent_status', coalesce((
      select jsonb_object_agg(parent_bucket, count order by parent_bucket)
      from (
        select
          case
            when parent_review_status = 'validated' then 'parent_validated'
            when parent_review_status = 'needs_review' then 'parent_needs_review'
            when parent_review_status = 'rejected' then 'parent_rejected'
            when parent_review_status is null then 'no_parent_or_root'
            else parent_review_status
          end as parent_bucket,
          count(*) as count
        from needs
        group by 1
      ) grouped
    ), '{}'::jsonb),
    'automation_opportunities', jsonb_build_object(
      'high_confidence_paragraphs_with_validated_parent', (
        select count(*) from needs
        where provision_type = 'paragraph'
          and extraction_confidence >= 88
          and parent_review_status = 'validated'
          and body_length >= 20
      ),
      'high_confidence_structure_nodes', (
        select count(*) from needs
        where provision_type in ('book','title','chapter','section','annex')
          and extraction_confidence >= 82
          and body_length >= 5
      ),
      'high_confidence_non_article_nodes', (
        select count(*) from needs
        where provision_type <> 'article'
          and extraction_confidence >= 88
          and body_length >= 20
      ),
      'short_or_empty_to_reject_candidates', (
        select count(*) from needs
        where coalesce(extraction_confidence, 0) < 50
           or body_text is null
           or body_length < 5
      ),
      'very_long_to_keep_manual', (
        select count(*) from needs
        where body_length >= 2000
      )
    ),
    'sample_needs_review', coalesce((
      select jsonb_agg(row_to_json(sample_row) order by extraction_confidence desc nulls last, sequence_number)
      from (
        select
          id,
          provision_type,
          number,
          heading,
          hierarchy_path,
          page_start,
          extraction_confidence,
          body_length,
          parent_review_status,
          left(body_text, 240) as body_preview
        from needs
        order by extraction_confidence desc nulls last, sequence_number
        limit 20
      ) sample_row
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_legal_needs_review_diagnostics(uuid) from public, anon, authenticated;
grant execute on function public.get_legal_needs_review_diagnostics(uuid) to authenticated;

comment on function public.get_legal_needs_review_diagnostics(uuid) is 'Admin-only diagnostics for legal provisions still needing review, used to improve extraction and automatic review thresholds.';
