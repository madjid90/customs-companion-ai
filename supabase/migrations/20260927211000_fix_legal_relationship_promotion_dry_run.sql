-- Promote high-confidence legal relationship candidates into canonical draft relationships.
-- This creates proposed relationships only. It never validates or publishes them.

create or replace function private.legal_reference_candidate_type(reference_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(reference_raw, '') ~* '\bd[ée]cret\b' then 'decree'
    when coalesce(reference_raw, '') ~* '\b(arr[êe]t[ée]|order)\b' then 'order'
    when coalesce(reference_raw, '') ~* '\b(circulaire|note)\b' then 'circular'
    when coalesce(reference_raw, '') ~* '\b(accord|convention|trait[ée])\b' then 'agreement'
    when coalesce(reference_raw, '') ~* '\b(dahir|loi)\b' then 'law'
    else 'guide'
  end
$$;

create or replace function private.legal_reference_authority_rank(instrument_type text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case instrument_type
    when 'constitution' then 1
    when 'treaty' then 5
    when 'agreement' then 8
    when 'law' then 10
    when 'customs_code' then 12
    when 'decree' then 20
    when 'order' then 30
    when 'circular' then 60
    when 'instruction' then 65
    when 'decision' then 70
    when 'procedure' then 75
    else 90
  end::smallint
$$;

create or replace function public.promote_legal_relationship_candidates_to_draft(
  target_version_id uuid,
  p_min_confidence numeric default 75,
  p_max_relationships integer default 50,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_instrument_id_value uuid;
  extraction_run_id_value uuid;
  version_status text;
  safe_limit integer := greatest(1, least(coalesce(p_max_relationships, 50), 500));
  confidence_threshold numeric := greatest(0, least(coalesce(p_min_confidence, 75), 100));
  candidate_count integer := 0;
  unique_reference_count integer := 0;
  existing_relationship_count integer := 0;
  would_insert_count integer := 0;
  inserted_relationships integer := 0;
  inserted_targets integer := 0;
  relation_item record;
  target_type text;
  target_rank smallint;
  target_instrument_id_value uuid;
  evidence_provision_id_value uuid;
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select
    v.instrument_id,
    v.status,
    (v.applicability_notes::jsonb->>'extraction_run_id')::uuid
  into source_instrument_id_value, version_status, extraction_run_id_value
  from public.legal_versions v
  where v.id = target_version_id;

  if source_instrument_id_value is null then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  if extraction_run_id_value is null then
    raise exception 'missing_extraction_run_id' using errcode = '22023';
  end if;

  if version_status = 'published' then
    raise exception 'published_version_is_immutable' using errcode = '22023';
  end if;

  select count(*) into candidate_count
  from public.legal_relationship_candidates c
  where c.extraction_run_id = extraction_run_id_value
    and c.publication_status = 'candidate'
    and c.validation_status = 'proposed'
    and c.reference_type = 'legal_instrument'
    and c.confidence >= confidence_threshold
    and c.relationship_type in ('amends','repeals','replaces','implements','interprets','complements','corrects','suspends','extends','creates_exception');

  with eligible as (
    select distinct on (c.reference_normalized, c.relationship_type)
      c.id,
      c.source_page_id,
      c.relationship_type,
      c.reference_raw,
      c.reference_normalized,
      private.legal_reference_candidate_type(c.reference_raw) as target_type,
      c.evidence_text,
      c.effective_from,
      c.confidence,
      c.relationship_index
    from public.legal_relationship_candidates c
    where c.extraction_run_id = extraction_run_id_value
      and c.publication_status = 'candidate'
      and c.validation_status = 'proposed'
      and c.reference_type = 'legal_instrument'
      and c.confidence >= confidence_threshold
      and c.relationship_type in ('amends','repeals','replaces','implements','interprets','complements','corrects','suspends','extends','creates_exception')
    order by c.reference_normalized, c.relationship_type, c.confidence desc nulls last, c.relationship_index
  ), checked as (
    select e.*,
      r.id as existing_relationship_id
    from eligible e
    left join public.legal_instruments ti
      on ti.jurisdiction_code = 'MA'
     and ti.instrument_type = e.target_type
     and ti.official_reference = e.reference_normalized
    left join public.legal_relationships r
      on r.source_instrument_id = source_instrument_id_value
     and r.target_instrument_id = ti.id
     and r.relationship_type = e.relationship_type
     and r.evidence_text = e.evidence_text
  )
  select
    count(*),
    count(*) filter (where existing_relationship_id is not null),
    count(*) filter (where existing_relationship_id is null)
  into unique_reference_count, existing_relationship_count, would_insert_count
  from checked;

  if p_dry_run then
    return jsonb_build_object(
      'version_id', target_version_id,
      'dry_run', true,
      'candidate_count', candidate_count,
      'unique_reference_count', unique_reference_count,
      'existing_relationship_count', existing_relationship_count,
      'would_insert_capped', least(safe_limit, would_insert_count),
      'publication_status', 'not_published_proposed_only',
      'thresholds', jsonb_build_object('min_confidence', confidence_threshold)
    );
  end if;

  for relation_item in
    select *
    from (
      select distinct on (c.reference_normalized, c.relationship_type)
        c.id,
        c.source_page_id,
        c.relationship_type,
        c.reference_raw,
        c.reference_normalized,
        c.evidence_text,
        c.effective_from,
        c.confidence,
        c.relationship_index
      from public.legal_relationship_candidates c
      where c.extraction_run_id = extraction_run_id_value
        and c.publication_status = 'candidate'
        and c.validation_status = 'proposed'
        and c.reference_type = 'legal_instrument'
        and c.confidence >= confidence_threshold
        and c.relationship_type in ('amends','repeals','replaces','implements','interprets','complements','corrects','suspends','extends','creates_exception')
      order by c.reference_normalized, c.relationship_type, c.confidence desc nulls last, c.relationship_index
    ) deduped
    order by confidence desc nulls last, relationship_index
    limit safe_limit
  loop
    target_type := private.legal_reference_candidate_type(relation_item.reference_raw);
    target_rank := private.legal_reference_authority_rank(target_type);

    insert into public.legal_instruments(
      jurisdiction_code,
      instrument_type,
      official_reference,
      canonical_title,
      issuing_authority,
      authority_rank,
      status
    ) values (
      'MA',
      target_type,
      relation_item.reference_normalized,
      left(relation_item.reference_raw, 500),
      'Autorité à vérifier',
      target_rank,
      'draft'
    )
    on conflict (jurisdiction_code, instrument_type, official_reference) do update
      set canonical_title = coalesce(nullif(public.legal_instruments.canonical_title, ''), excluded.canonical_title),
          issuing_authority = public.legal_instruments.issuing_authority,
          authority_rank = public.legal_instruments.authority_rank,
          updated_at = now()
    returning id into target_instrument_id_value;

    if not exists (
      select 1
      from public.legal_versions v
      where v.instrument_id = target_instrument_id_value
    ) then
      inserted_targets := inserted_targets + 1;
    end if;

    select p.id into evidence_provision_id_value
    from public.legal_provisions p
    left join public.source_pages sp on sp.id = relation_item.source_page_id
    where p.legal_version_id = target_version_id
      and p.review_status = 'validated'
      and (
        sp.page_number is null
        or (
          p.page_start is not null
          and p.page_start <= sp.page_number
          and coalesce(p.page_end, p.page_start) >= sp.page_number
        )
      )
    order by
      case p.provision_type
        when 'article' then 1
        when 'paragraph' then 2
        when 'section' then 3
        else 4
      end,
      p.sequence_number
    limit 1;

    insert into public.legal_relationships(
      source_instrument_id,
      source_provision_id,
      target_instrument_id,
      target_provision_id,
      relationship_type,
      effective_from,
      evidence_text,
      evidence_provision_id,
      confidence,
      validation_status
    )
    select
      source_instrument_id_value,
      evidence_provision_id_value,
      target_instrument_id_value,
      null,
      relation_item.relationship_type,
      relation_item.effective_from,
      relation_item.evidence_text,
      evidence_provision_id_value,
      relation_item.confidence,
      'proposed'
    where not exists (
      select 1
      from public.legal_relationships r
      where r.source_instrument_id = source_instrument_id_value
        and r.target_instrument_id = target_instrument_id_value
        and r.relationship_type = relation_item.relationship_type
        and r.evidence_text = relation_item.evidence_text
    );

    if found then
      inserted_relationships := inserted_relationships + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'version_id', target_version_id,
    'dry_run', false,
    'candidate_count', candidate_count,
    'unique_reference_count', unique_reference_count,
    'existing_relationship_count_before', existing_relationship_count,
    'inserted_relationships', inserted_relationships,
    'created_or_reused_target_instruments', least(safe_limit, unique_reference_count),
    'placeholder_targets_without_versions', inserted_targets,
    'publication_status', 'not_published_proposed_only',
    'thresholds', jsonb_build_object('min_confidence', confidence_threshold)
  );
end;
$$;

revoke all on function public.promote_legal_relationship_candidates_to_draft(uuid, numeric, integer, boolean) from public, anon, authenticated;
grant execute on function public.promote_legal_relationship_candidates_to_draft(uuid, numeric, integer, boolean) to authenticated;

comment on function public.promote_legal_relationship_candidates_to_draft(uuid, numeric, integer, boolean) is 'Admin-only promotion of high-confidence legal relationship candidates into proposed canonical relationships. Creates draft target instruments when needed and never validates or publishes relationships.';
