create table public.source_page_revisions (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete restrict,
  ingestion_issue_id uuid references public.ingestion_issues(id) on delete set null,
  previous_text text not null,
  previous_sha256 text not null,
  corrected_text text not null,
  corrected_sha256 text not null,
  correction_reason text not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  check (previous_sha256 <> corrected_sha256),
  check (length(btrim(correction_reason)) >= 10)
);
create index source_page_revisions_page_idx on public.source_page_revisions(source_page_id, reviewed_at desc);
alter table public.source_page_revisions enable row level security;
grant select on public.source_page_revisions to authenticated;
create policy source_page_revisions_admin_read on public.source_page_revisions for select to authenticated
using ((select private.is_platform_admin()));

create or replace function public.correct_source_page(
  target_issue_id uuid,
  corrected_text_input text,
  correction_reason_input text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  issue_record public.ingestion_issues%rowtype;
  page_record public.source_pages%rowtype;
  document_status text;
  corrected_hash text;
  reviewer_id uuid := (select auth.uid());
begin
  if not (select private.is_platform_admin()) or reviewer_id is null then
    raise exception 'Platform administrator required';
  end if;
  if length(btrim(coalesce(corrected_text_input, ''))) < 80 then
    raise exception 'Corrected page text must contain at least 80 characters';
  end if;
  if length(btrim(coalesce(correction_reason_input, ''))) < 10 then
    raise exception 'Explain how the correction was verified';
  end if;
  select * into issue_record from public.ingestion_issues where id = target_issue_id for update;
  if not found or issue_record.status <> 'open' or issue_record.page_number is null then
    raise exception 'Open page issue required';
  end if;
  select p.* into page_record
  from public.source_pages p
  join public.ingestion_runs r on r.source_document_id = p.source_document_id
  where r.id = issue_record.ingestion_run_id and p.page_number = issue_record.page_number
  for update of p;
  if not found then
    raise exception 'Source page missing; re-run extraction before correction';
  end if;
  select lifecycle_status into document_status from public.source_documents where id = page_record.source_document_id;
  if document_status = 'published' then
    raise exception 'Published source is immutable; ingest a new revision';
  end if;
  corrected_hash := encode(extensions.digest(convert_to(btrim(corrected_text_input), 'UTF8'), 'sha256'), 'hex');
  if corrected_hash = page_record.text_sha256 then
    raise exception 'Correction must change the extracted text';
  end if;
  insert into public.source_page_revisions (
    source_page_id, ingestion_issue_id, previous_text, previous_sha256,
    corrected_text, corrected_sha256, correction_reason, reviewed_by
  ) values (
    page_record.id, issue_record.id, page_record.text_content, page_record.text_sha256,
    btrim(corrected_text_input), corrected_hash, btrim(correction_reason_input), reviewer_id
  );
  update public.source_pages set
    text_content = btrim(corrected_text_input), text_sha256 = corrected_hash,
    extraction_method = 'hybrid', extraction_confidence = 95,
    review_status = 'validated',
    metadata = metadata || jsonb_build_object('manually_corrected', true, 'corrected_at', now())
  where id = page_record.id;
  update public.ingestion_issues set
    status = 'resolved', resolution = btrim(correction_reason_input),
    resolved_by = reviewer_id, resolved_at = now()
  where id = issue_record.id;
  return page_record.id;
end;
$$;
revoke all on function public.correct_source_page(uuid, text, text) from public;
grant execute on function public.correct_source_page(uuid, text, text) to authenticated;
