-- Cover the tariff extraction run reference to pipeline_versions reported by
-- the Supabase performance advisor.

create index tariff_extraction_runs_pipeline_idx
  on public.tariff_extraction_runs(pipeline_version_id);
