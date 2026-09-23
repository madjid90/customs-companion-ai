-- Cover orchestration foreign keys used for version retirement and joins.
create index ingestion_jobs_pipeline_idx on public.ingestion_jobs(pipeline_version_id);
create index page_diagnostics_pipeline_idx on public.page_diagnostics(pipeline_version_id);
create index page_engine_outputs_pipeline_idx on public.page_engine_outputs(pipeline_version_id);
create index page_blocks_engine_output_idx on public.page_blocks(engine_output_id);
