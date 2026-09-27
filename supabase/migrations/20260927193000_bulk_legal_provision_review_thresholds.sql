-- Bulk review thresholds for canonical draft legal provisions.
-- This automates only clear extraction-quality cases and keeps ambiguous content in review.

create or replace function public.apply_legal_provision_review_thresholds(
  target_version_id uuid,
  p_validate_article_confidence numeric default 94,
  p_validate_structure_confidence numeric default 88,
  p_reject_below_confidence numeric default 50,
  p_max_updates integer default 250,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_status text;
  safe_max_updates integer := greatest(1, least(coalesce(p_max_updates, 250), 2000));
  validate_article_threshold numeric := greatest(0, least(coalesce(p_validate_article_confidence, 94), 100));
  validate_structure_threshold numeric := greatest(0, least(coalesce(p_validate_structure_confidence, 88), 100));
  reject_threshold numeric := greatest(0, least(coalesce(p_reject_below_confidence, 50), 100));
  validate_count integer := 0;
  reject_count integer := 0;
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

  if reject_threshold >= validate_structure_threshold or reject_threshold >= validate_article_threshold then
    raise exception 'invalid_threshold_order' using errcode = '22023';
  end if;

  with eligible_validate as (
    select id
    from public.legal_provisions
    where legal_version_id = target_version_id
      and review_status = 'needs_review'
      and (
        (provision_type = 'article' and extraction_confidence >= validate_article_threshold and body_text is not null and length(btrim(body_text)) >= 20)
        or
        (provision_type in ('book','title','chapter','section','annex') and extraction_confidence >= validate_structure_threshold and body_text is not null and length(btrim(body_text)) >= 5)
      )
    order by extraction_confidence desc nulls last, sequence_number
    limit safe_max_updates
  )
  select count(*) into validate_count from eligible_validate;

  with eligible_reject as (
    select id
    from public.legal_provisions
    where legal_version_id = target_version_id
      and review_status = 'needs_review'
      and (
        coalesce(extraction_confidence, 0) < reject_threshold
        or body_text is null
        or length(btrim(body_text)) < 5
      )
    order by extraction_confidence nulls first, sequence_number
    limit safe_max_updates
  )
  select count(*) into reject_count from eligible_reject;

  if not p_dry_run then
    with eligible_validate as (
      select id
      from public.legal_provisions
      where legal_version_id = target_version_id
        and review_status = 'needs_review'
        and (
          (provision_type = 'article' and extraction_confidence >= validate_article_threshold and body_text is not null and length(btrim(body_text)) >= 20)
          or
          (provision_type in ('book','title','chapter','section','annex') and extraction_confidence >= validate_structure_threshold and body_text is not null and length(btrim(body_text)) >= 5)
        )
      order by extraction_confidence desc nulls last, sequence_number
      limit safe_max_updates
    ), updated_validate as (
      update public.legal_provisions p
      set review_status = 'validated'
      from eligible_validate e
      where p.id = e.id
      returning p.id
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
      'bulk_threshold_validation',
      'Validated by strict extraction-confidence threshold; still unpublished until version publication gates pass.',
      jsonb_build_object(
        'source', 'apply_legal_provision_review_thresholds',
        'article_threshold', validate_article_threshold,
        'structure_threshold', validate_structure_threshold,
        'reject_threshold', reject_threshold
      )
    from updated_validate;

    with eligible_reject as (
      select id
      from public.legal_provisions
      where legal_version_id = target_version_id
        and review_status = 'needs_review'
        and (
          coalesce(extraction_confidence, 0) < reject_threshold
          or body_text is null
          or length(btrim(body_text)) < 5
        )
      order by extraction_confidence nulls first, sequence_number
      limit safe_max_updates
    ), updated_reject as (
      update public.legal_provisions p
      set review_status = 'rejected'
      from eligible_reject e
      where p.id = e.id
      returning p.id
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
      'rejected',
      (select auth.uid()),
      'bulk_threshold_rejection',
      'Rejected by low extraction-confidence or empty-text threshold; source document remains accepted.',
      jsonb_build_object(
        'source', 'apply_legal_provision_review_thresholds',
        'article_threshold', validate_article_threshold,
        'structure_threshold', validate_structure_threshold,
        'reject_threshold', reject_threshold
      )
    from updated_reject;
  end if;

  result := jsonb_build_object(
    'version_id', target_version_id,
    'dry_run', p_dry_run,
    'would_validate_or_validated', validate_count,
    'would_reject_or_rejected', reject_count,
    'max_updates_per_action', safe_max_updates,
    'thresholds', jsonb_build_object(
      'validate_article_confidence', validate_article_threshold,
      'validate_structure_confidence', validate_structure_threshold,
      'reject_below_confidence', reject_threshold
    ),
    'publication_status', 'not_published_review_only'
  );

  return result;
end;
$$;

revoke all on function public.apply_legal_provision_review_thresholds(uuid, numeric, numeric, numeric, integer, boolean) from public, anon, authenticated;
grant execute on function public.apply_legal_provision_review_thresholds(uuid, numeric, numeric, numeric, integer, boolean) to authenticated;

comment on function public.apply_legal_provision_review_thresholds(uuid, numeric, numeric, numeric, integer, boolean) is 'Admin-only bulk review for draft legal provisions using strict confidence thresholds. Supports dry-run and never publishes legal versions.';
