-- The manually supplied corpus remains provisional, but can be searched while
-- legal validation proceeds. Rejected documents and pages are never exposed.
create extension if not exists pg_trgm;

create index if not exists source_pages_text_trgm_idx
  on public.source_pages using gin (text_content gin_trgm_ops);
create index if not exists hs_candidates_description_trgm_idx
  on public.hs_extraction_candidates using gin (description_fragment gin_trgm_ops);

create policy source_documents_provisional_read on public.source_documents
  for select to authenticated using (
    lifecycle_status in ('extracted', 'quality_review', 'legal_review')
    and exists (select 1 from public.regulatory_sources s
      where s.id = source_id and s.code = 'MA_MANUAL_CORPUS')
  );

create policy source_pages_provisional_read on public.source_pages
  for select to authenticated using (
    review_status <> 'rejected'
    and exists (select 1 from public.source_documents d
      join public.regulatory_sources s on s.id = d.source_id
      where d.id = source_document_id
        and s.code = 'MA_MANUAL_CORPUS'
        and d.lifecycle_status in ('extracted', 'quality_review', 'legal_review'))
  );

create policy hs_candidates_provisional_read on public.hs_extraction_candidates
  for select to authenticated using (
    review_status <> 'rejected'
    and exists (select 1 from public.source_documents d
      join public.regulatory_sources s on s.id = d.source_id
      where d.id = source_document_id
        and s.code = 'MA_MANUAL_CORPUS'
        and d.lifecycle_status in ('extracted', 'quality_review', 'legal_review'))
  );

create policy "Authenticated users read provisional legal source files"
  on storage.objects for select to authenticated using (
    bucket_id = 'legal-source-pdfs'
    and exists (select 1 from public.source_documents d
      join public.regulatory_sources s on s.id = d.source_id
      where d.storage_bucket = bucket_id and d.storage_path = name
        and s.code = 'MA_MANUAL_CORPUS'
        and d.lifecycle_status in ('extracted', 'quality_review', 'legal_review'))
  );
