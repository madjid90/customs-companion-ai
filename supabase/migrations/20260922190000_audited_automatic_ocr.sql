-- OCR can improve accessibility automatically without pretending its output
-- was checked by a human or making it a published legal source.
create table public.automated_page_revisions (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete restrict,
  ingestion_issue_id uuid not null references public.ingestion_issues(id) on delete restrict,
  previous_sha256 text not null,
  new_sha256 text not null,
  engine text not null,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  initiated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (previous_sha256 <> new_sha256)
);
create index automated_page_revisions_page_idx on public.automated_page_revisions(source_page_id,created_at desc);
alter table public.automated_page_revisions enable row level security;
grant select on public.automated_page_revisions to authenticated;
create policy automated_page_revisions_admin_read on public.automated_page_revisions
  for select to authenticated using ((select private.is_platform_admin()));

create function public.apply_automatic_ocr(target_issue_id uuid, ocr_text text, ocr_confidence numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  issue_row public.ingestion_issues%rowtype;
  page_row public.source_pages%rowtype;
  document_status text;
  new_hash text;
begin
  if not (select private.is_platform_admin()) or (select auth.uid()) is null then
    raise exception 'Platform administrator required';
  end if;
  if length(btrim(coalesce(ocr_text,''))) < 80 or ocr_confidence is null or ocr_confidence < 0 or ocr_confidence > 100 then
    raise exception 'OCR text or confidence invalid';
  end if;
  select * into issue_row from public.ingestion_issues where id = target_issue_id for update;
  if not found or issue_row.status <> 'open' or issue_row.issue_type not in ('empty_page','ocr_noise') or issue_row.page_number is null then
    raise exception 'Open OCR page issue required';
  end if;
  select p.* into page_row from public.source_pages p
    join public.ingestion_runs r on r.source_document_id = p.source_document_id
    where r.id = issue_row.ingestion_run_id and p.page_number = issue_row.page_number
    for update of p;
  if not found then raise exception 'Source page missing'; end if;
  select lifecycle_status into document_status from public.source_documents where id = page_row.source_document_id;
  if document_status in ('published','rejected','superseded') then
    raise exception 'Document cannot be automatically modified';
  end if;
  new_hash := encode(extensions.digest(convert_to(btrim(ocr_text),'UTF8'),'sha256'),'hex');
  if new_hash = page_row.text_sha256 then return page_row.id; end if;
  insert into public.automated_page_revisions(source_page_id,ingestion_issue_id,previous_sha256,new_sha256,engine,confidence,initiated_by)
    values(page_row.id,issue_row.id,page_row.text_sha256,new_hash,'tesseract.js-6',ocr_confidence,(select auth.uid()));
  update public.source_pages set text_content = btrim(ocr_text), text_sha256 = new_hash,
    extraction_method = 'ocr', extraction_confidence = ocr_confidence,
    review_status = 'needs_review',
    metadata = metadata || jsonb_build_object('chars',length(btrim(ocr_text)),
      'ocr_confidence',ocr_confidence,'automatic_ocr_at',now())
  where id = page_row.id;
  update public.ingestion_issues set issue_type = 'ocr_noise', severity = 'warning',
    description = 'OCR automatique disponible : contrôler les caractères, codes SH et tableaux',
    evidence = evidence || jsonb_build_object('ocr_confidence',ocr_confidence)
  where id = issue_row.id;
  return page_row.id;
end;
$$;
revoke all on function public.apply_automatic_ocr(uuid,text,numeric) from public, anon;
grant execute on function public.apply_automatic_ocr(uuid,text,numeric) to authenticated;
