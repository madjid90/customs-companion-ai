-- REQ-01/REQ-02: a page rejected by all text engines advances to layout/vision.
insert into public.ingestion_jobs(job_type,pipeline_version_id,source_document_id,source_page_id,idempotency_key,payload,priority)
select 'analyze_layout','page-diagnostic-v1',p.source_document_id,d.source_page_id,
  'analyze_layout:'||d.source_page_id::text||':page-diagnostic-v1',
  jsonb_build_object('reason','all_text_engines_empty','page_number',p.page_number),95
from public.page_fusion_decisions d
join public.source_pages p on p.id=d.source_page_id
where d.status='rejected'
on conflict(idempotency_key) do nothing;
