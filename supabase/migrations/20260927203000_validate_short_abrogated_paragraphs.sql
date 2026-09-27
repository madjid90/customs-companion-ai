-- Hierarchy-aware review automation for legal provisions that remain in needs_review.
-- It validates reliable child paragraphs when the parent article is already validated,
-- reliable structural headings, and short explicit abrogation markers. Very long paragraphs remain manual.

create or replace function public.apply_hierarchy_aware_legal_review(
  target_version_id uuid,
  p_paragraph_confidence numeric default 88,
  p_structure_confidence numeric default 82,
  p_max_updates integer default 1000,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_status text;
  safe_max_updates integer := greatest(1, least(coalesce(p_max_updates, 1000), 3000));
  paragraph_threshold numeric := greatest(0, least(coalesce(p_paragraph_confidence, 88), 100));
  structure_threshold numeric := greatest(0, least(coalesce(p_structure_confidence, 82), 100));
  hierarchy_validate_count integer := 0;
  structure_validate_count integer := 0;
  short_abrogated_article_count integer := 0;
  short_abrogated_paragraph_count integer := 0;
  total_to_validate integer := 0;
  result jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select status into version_status
  from public.legal_versions
  where id = target_version_id;

  if version_status is null then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  if version_status = 'published' then
    raise exception 'published_version_is_immutable' using errcode = '22023';
  end if;

  with provisions as (
    select
      p.id,
      p.provision_type,
      p.extraction_confidence,
      length(btrim(coalesce(p.body_text, ''))) as body_length,
      p.body_text,
      parent.review_status as parent_review_status
    from public.legal_provisions p
    left join public.legal_provisions parent
      on parent.legal_version_id = p.legal_version_id
     and parent.hierarchy_path = regexp_replace(p.hierarchy_path, '/[^/]+$', '')
    where p.legal_version_id = target_version_id
      and p.review_status = 'needs_review'
  )
  select
    count(*) filter (
      where provision_type = 'paragraph'
        and extraction_confidence >= paragraph_threshold
        and parent_review_status = 'validated'
        and body_length >= 20
        and body_length < 2000
    ),
    count(*) filter (
      where provision_type in ('book','title','chapter','section','annex')
        and extraction_confidence >= structure_threshold
        and body_length >= 5
    ),
    count(*) filter (
      where provision_type = 'article'
        and extraction_confidence >= 94
        and body_length >= 10
        and body_text ~* '\m(abrog[ée]?)\M'
    ),
    count(*) filter (
      where provision_type = 'paragraph'
        and extraction_confidence >= paragraph_threshold
        and parent_review_status = 'validated'
        and body_length < 20
        and body_text ~* '^\s*[(-–—]*\s*abrog[ée]?\)?\s*[.;:]*\s*$'
    )
  into hierarchy_validate_count, structure_validate_count, short_abrogated_article_count, short_abrogated_paragraph_count
  from provisions;

  total_to_validate := least(safe_max_updates, hierarchy_validate_count + structure_validate_count + short_abrogated_article_count + short_abrogated_paragraph_count);

  if not p_dry_run then
    with provisions as (
      select
        p.id,
        p.provision_type,
        p.extraction_confidence,
        p.sequence_number,
        length(btrim(coalesce(p.body_text, ''))) as body_length,
        p.body_text,
        parent.review_status as parent_review_status,
        case
          when p.provision_type = 'paragraph'
            and p.extraction_confidence >= paragraph_threshold
            and parent.review_status = 'validated'
            and length(btrim(coalesce(p.body_text, ''))) >= 20
            and length(btrim(coalesce(p.body_text, ''))) < 2000
          then 'validated_paragraph_with_validated_parent'
          when p.provision_type in ('book','title','chapter','section','annex')
            and p.extraction_confidence >= structure_threshold
            and length(btrim(coalesce(p.body_text, ''))) >= 5
          then 'validated_structure_node'
          when p.provision_type = 'article'
            and p.extraction_confidence >= 94
            and length(btrim(coalesce(p.body_text, ''))) >= 10
            and p.body_text ~* '\m(abrog[ée]?)\M'
          then 'validated_short_abrogated_article'
          when p.provision_type = 'paragraph'
            and p.extraction_confidence >= paragraph_threshold
            and parent.review_status = 'validated'
            and length(btrim(coalesce(p.body_text, ''))) < 20
            and p.body_text ~* '^\s*[(-–—]*\s*abrog[ée]?\)?\s*[.;:]*\s*$'
          then 'validated_short_abrogated_paragraph'
          else null
        end as rule_reason
      from public.legal_provisions p
      left join public.legal_provisions parent
        on parent.legal_version_id = p.legal_version_id
       and parent.hierarchy_path = regexp_replace(p.hierarchy_path, '/[^/]+$', '')
      where p.legal_version_id = target_version_id
        and p.review_status = 'needs_review'
    ), eligible as (
      select id, rule_reason
      from provisions
      where rule_reason is not null
      order by
        case rule_reason
          when 'validated_structure_node' then 1
          when 'validated_short_abrogated_article' then 2
          when 'validated_short_abrogated_paragraph' then 3
          when 'validated_paragraph_with_validated_parent' then 4
          else 4
        end,
        extraction_confidence desc nulls last,
        sequence_number
      limit safe_max_updates
    ), updated as (
      update public.legal_provisions p
      set review_status = 'validated'
      from eligible e
      where p.id = e.id
      returning p.id, e.rule_reason
    )
    insert into public.legal_provision_review_events(
      legal_provision_id,
      legal_version_id,
      previous_status,
      new_status,
      reviewer_id,
      review_reason,
      review_note,
      metadata
    )
    select
      id,
      target_version_id,
      'needs_review',
      'validated',
      (select auth.uid()),
      rule_reason,
      'Validated by hierarchy-aware extraction rule; still unpublished until publication gates pass.',
      jsonb_build_object(
        'source', 'apply_hierarchy_aware_legal_review',
        'paragraph_threshold', paragraph_threshold,
        'structure_threshold', structure_threshold
      )
    from updated;
  end if;

  result := jsonb_build_object(
    'version_id', target_version_id,
    'dry_run', p_dry_run,
    'would_validate_or_validated_total_capped', total_to_validate,
    'candidates_by_rule', jsonb_build_object(
      'validated_paragraph_with_validated_parent', hierarchy_validate_count,
      'validated_structure_node', structure_validate_count,
      'validated_short_abrogated_article', short_abrogated_article_count,
      'validated_short_abrogated_paragraph', short_abrogated_paragraph_count
    ),
    'max_updates', safe_max_updates,
    'thresholds', jsonb_build_object(
      'paragraph_confidence', paragraph_threshold,
      'structure_confidence', structure_threshold
    ),
    'publication_status', 'not_published_review_only'
  );

  return result;
end;
$$;

revoke all on function public.apply_hierarchy_aware_legal_review(uuid, numeric, numeric, integer, boolean) from public, anon, authenticated;
grant execute on function public.apply_hierarchy_aware_legal_review(uuid, numeric, numeric, integer, boolean) to authenticated;

comment on function public.apply_hierarchy_aware_legal_review(uuid, numeric, numeric, integer, boolean) is 'Admin-only hierarchy-aware validation for draft legal provisions. Validates reliable child paragraphs, structure nodes, and explicit abrogation markers; never publishes legal versions.';
