-- Allow deterministic HTML source snapshots to be stored as source_pages.
-- This supports official web pages captured by source-discovery without
-- pretending they came from a PDF/OCR pipeline.

alter table public.source_pages
  drop constraint if exists source_pages_extraction_method_check;

alter table public.source_pages
  add constraint source_pages_extraction_method_check
  check (extraction_method in ('native_pdf','ocr','vision','hybrid','html_snapshot'));
