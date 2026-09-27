-- Controlled draft promotion from legal staging batches into canonical legal draft tables.
-- This creates draft/review canonical rows only. It never publishes a legal version.

create or replace function private.legal_candidate_instrument_type(document_type text, metadata jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(metadata->'auto_profile'->>'role', '') = 'circular' then 'circular'
    when document_type = 'customs_code' then 'customs_code'
    when document_type = 'agreement' then 'agreement'
    when document_type = 'circular' then 'circular'
    when document_type = 'instruction' then 'instruction'
    when document_type = 'procedure' then 'procedure'
    else 'guide'
  end
$$;

create or replace function private.legal_candidate_authority_rank(instrument_type text)
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

create or replace function private.legal_candidate_reference(document_id uuid, title text, document_type text, metadata jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(metadata->'auto_legal_context'->>'official_reference_candidate'), ''),
    case
      when document_type = 'customs_code' and coalesce(title, '') ~* '2023' then 'CDII-2023'
      when document_type = 'customs_code' then 'CDII-' || left(document_id::text, 8)
      else null
    end,
    'UNVERIFIED_SOURCE:' || document_id::text
  )
$$;

create or replace function private.legal_candidate_title(title text, document_type text, metadata jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select left(coalesce(
    nullif(btrim(metadata->'auto_legal_context'->>'object_candidate'), ''),
    nullif(btrim(metadata->'auto_profile'->>'heading'), ''),
    nullif(btrim(title), ''),
    'Document juridique importé'
  ), 500)
$$;

create or replace function public.promote_legal_staging_batch_to_draft(
  target_batch_id uuid,
  p_max_runs integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_max_runs, 5), 25));
  batch_status text;
  row_item record;
  candidate_type text;
  candidate_reference text;
  candidate_title text;
  candidate_rank smallint;
  candidate_authority text;
  instrument_id_value uuid;
  version_id_value uuid;
  inserted_provisions integer;
  processed_runs integer := 0;
  created_versions integer := 0;
  created_provisions integer := 0;
  result jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select status into batch_status
  from public.legal_promotion_batches
  where id = target_batch_id;

  if batch_status is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;

  if batch_status not in ('ready','draft') then
    raise exception 'batch_not_promotable:%', batch_status using errcode = '22023';
  end if;

  for row_item in
    select
      br.id as batch_run_id,
      br.extraction_run_id,
      br.source_document_id,
      br.selection_bucket,
      br.review_status as batch_run_status,
      r.input_signature_sha256,
      r.status as extraction_status,
      r.quality_score,
      d.title,
      d.official_reference,
      d.document_type,
      d.publication_date,
      d.effective_from,
      d.effective_to,
      d.metadata,
      d.sha256
    from public.legal_promotion_batch_runs br
    join public.legal_extraction_runs r on r.id = br.extraction_run_id
    join public.source_documents d on d.id = br.source_document_id
    where br.batch_id = target_batch_id
      and br.review_status in ('queued','accepted')
      and not exists (
        select 1
        from public.legal_versions v
        where v.source_document_id = br.source_document_id
          and v.content_hash = r.input_signature_sha256
      )
    order by
      case br.selection_bucket
        when 'promotion_candidate_article_based' then 1
        when 'review_candidate_circular_context' then 2
        else 3
      end,
      r.quality_score desc nulls last,
      br.provision_count desc
    limit safe_limit
  loop
    candidate_type := private.legal_candidate_instrument_type(row_item.document_type, row_item.metadata);
    candidate_reference := coalesce(row_item.official_reference, private.legal_candidate_reference(row_item.source_document_id, row_item.title, row_item.document_type, row_item.metadata));
    candidate_title := private.legal_candidate_title(row_item.title, row_item.document_type, row_item.metadata);
    candidate_rank := private.legal_candidate_authority_rank(candidate_type);
    candidate_authority := case
      when candidate_type in ('customs_code','circular','instruction','procedure') then 'Administration des Douanes et Impôts Indirects'
      when candidate_type = 'agreement' then 'Autorité compétente - accord international'
      else 'Autorité à vérifier'
    end;

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
      candidate_type,
      candidate_reference,
      candidate_title,
      candidate_authority,
      candidate_rank,
      'draft'
    )
    on conflict (jurisdiction_code, instrument_type, official_reference) do update
      set canonical_title = excluded.canonical_title,
          issuing_authority = excluded.issuing_authority,
          authority_rank = excluded.authority_rank,
          updated_at = now()
    returning id into instrument_id_value;

    insert into public.legal_versions(
      instrument_id,
      source_document_id,
      version_label,
      publication_date,
      effective_from,
      effective_to,
      status,
      content_hash,
      applicability_notes
    ) values (
      instrument_id_value,
      row_item.source_document_id,
      'Draft extraction ' || left(row_item.extraction_run_id::text, 8),
      row_item.publication_date,
      row_item.effective_from,
      row_item.effective_to,
      'review',
      row_item.input_signature_sha256,
      jsonb_build_object(
        'promotion_source', 'legal_promotion_batch',
        'batch_id', target_batch_id,
        'batch_run_id', row_item.batch_run_id,
        'extraction_run_id', row_item.extraction_run_id,
        'selection_bucket', row_item.selection_bucket,
        'official_reference_verified', row_item.official_reference is not null,
        'candidate_reference', candidate_reference,
        'quality_score', row_item.quality_score,
        'publication_mode', 'draft_review_not_published'
      )::text
    )
    on conflict (instrument_id, content_hash) do update
      set status = case when public.legal_versions.status = 'published' then public.legal_versions.status else 'review' end,
          applicability_notes = excluded.applicability_notes
    returning id into version_id_value;

    with inserted as (
      insert into public.legal_provisions(
        legal_version_id,
        provision_type,
        number,
        heading,
        body_text,
        hierarchy_path,
        sequence_number,
        page_start,
        page_end,
        extraction_confidence,
        review_status
      )
      select
        version_id_value,
        c.provision_type,
        c.number,
        c.heading,
        c.body_text,
        c.hierarchy_path,
        c.sequence_number,
        c.page_start,
        c.page_end,
        c.extraction_confidence,
        case
          when c.provision_type = 'article' and c.extraction_confidence >= 90 then 'needs_review'
          else 'needs_review'
        end
      from public.legal_provision_candidates c
      where c.extraction_run_id = row_item.extraction_run_id
        and c.publication_status = 'candidate'
        and c.validation_status = 'proposed'
        and (
          (row_item.selection_bucket = 'promotion_candidate_article_based' and c.provision_type in ('book','title','chapter','section','article','paragraph','annex'))
          or
          (row_item.selection_bucket = 'review_candidate_circular_context' and c.metadata->>'extraction_mode' = 'postgres_circular_fallback_v1')
        )
      order by c.sequence_number
      on conflict (legal_version_id, hierarchy_path) do nothing
      returning 1
    )
    select count(*) into inserted_provisions from inserted;

    update public.legal_promotion_batch_runs
    set review_status = 'accepted'
    where id = row_item.batch_run_id;

    processed_runs := processed_runs + 1;
    created_versions := created_versions + 1;
    created_provisions := created_provisions + inserted_provisions;
  end loop;

  update public.legal_promotion_batches
  set status = case when processed_runs > 0 then 'promoted' else status end,
      metrics = metrics || jsonb_build_object(
        'draft_promotion_at', now(),
        'draft_promoted_runs', processed_runs,
        'draft_versions_created_or_reused', created_versions,
        'draft_provisions_inserted', created_provisions,
        'draft_publication_mode', 'review_not_published'
      ),
      updated_at = now()
  where id = target_batch_id;

  result := jsonb_build_object(
    'batch_id', target_batch_id,
    'processed_runs', processed_runs,
    'created_or_reused_versions', created_versions,
    'inserted_provisions', created_provisions,
    'publication_status', 'not_published_review_only'
  );

  return result;
end;
$$;

revoke all on function private.legal_candidate_instrument_type(text, jsonb) from public, anon, authenticated;
revoke all on function private.legal_candidate_authority_rank(text) from public, anon, authenticated;
revoke all on function private.legal_candidate_reference(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.legal_candidate_title(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.promote_legal_staging_batch_to_draft(uuid, integer) from public, anon, authenticated;
grant execute on function public.promote_legal_staging_batch_to_draft(uuid, integer) to authenticated;

comment on function public.promote_legal_staging_batch_to_draft(uuid, integer) is 'Admin-only controlled promotion from a staging batch into draft/review canonical legal tables. Never publishes legal versions.';
