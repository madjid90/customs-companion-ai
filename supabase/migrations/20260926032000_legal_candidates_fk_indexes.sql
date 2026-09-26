-- Keep legal candidate worker writes and cleanup efficient when deleting documents,
-- pages or pipeline versions.

create index if not exists legal_extraction_runs_pipeline_idx
  on public.legal_extraction_runs(pipeline_version_id);

create index if not exists legal_provision_candidates_source_page_idx
  on public.legal_provision_candidates(source_page_id)
  where source_page_id is not null;

create index if not exists legal_relationship_candidates_document_idx
  on public.legal_relationship_candidates(source_document_id,created_at desc);

create index if not exists legal_relationship_candidates_source_page_idx
  on public.legal_relationship_candidates(source_page_id)
  where source_page_id is not null;
