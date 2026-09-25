-- REQ-01/REQ-02: structural page classification independent from OCR output.
update public.pipeline_versions set active=false where component='page-diagnostic' and active;
insert into public.pipeline_versions(id,component,configuration,code_revision,active)
values ('page-diagnostic-v2','page-diagnostic',jsonb_build_object('classes',jsonb_build_array('blank','native_text','scanned','hybrid','short_text','table','form','vector_complex','unknown')),'9b21d1f',true);

create table public.page_diagnostic_results (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  page_class text not null check(page_class in ('blank','native_text','scanned','hybrid','short_text','table','form','vector_complex','unknown')),
  recommended_strategy text not null check(recommended_strategy in ('none','native_pdf','compare','pdfium','ocr','layout','vision','hybrid','quarantine')),
  confidence numeric(5,2) not null check(confidence between 0 and 100),
  reason_codes text[] not null default '{}',
  metrics jsonb not null check(jsonb_typeof(metrics)='object'),
  created_at timestamptz not null default now(),
  unique(source_page_id,pipeline_version_id)
);
create index page_diagnostic_results_class_idx on public.page_diagnostic_results(page_class,recommended_strategy);
create index page_diagnostic_results_pipeline_idx on public.page_diagnostic_results(pipeline_version_id);
alter table public.page_diagnostic_results enable row level security;
revoke all on public.page_diagnostic_results from public,anon,authenticated;
grant select,insert,update,delete on public.page_diagnostic_results to service_role;

