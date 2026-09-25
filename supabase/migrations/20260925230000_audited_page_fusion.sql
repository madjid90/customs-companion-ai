-- REQ-02: immutable, service-only decisions comparing native PDF, PDFium and OCR.

insert into public.pipeline_versions(id,component,configuration,code_revision,active)
values (
  'page-fusion-v1',
  'page-fusion',
  jsonb_build_object(
    'minimum_score',55,
    'minimum_margin',6,
    'engines',jsonb_build_array('native_pdf','pdfium','ocr')
  ),
  'pending',
  true
);

create table public.page_fusion_decisions (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  input_signature text not null check (input_signature ~ '^[a-f0-9]{64}$'),
  selected_source text not null check (selected_source in ('native_pdf','pdfium','ocr','hybrid','none')),
  selected_engine_output_id uuid references public.page_engine_outputs(id) on delete restrict,
  selected_text_sha256 text check (selected_text_sha256 ~ '^[a-f0-9]{64}$'),
  selected_score numeric(5,2) check (selected_score between 0 and 100),
  status text not null check (status in ('selected','review_required','rejected')),
  reason_codes text[] not null default '{}',
  candidate_scores jsonb not null check (jsonb_typeof(candidate_scores)='array'),
  algorithm_version text not null,
  created_at timestamptz not null default now(),
  unique(source_page_id,pipeline_version_id,input_signature),
  check (
    (selected_source='none' and selected_engine_output_id is null and selected_text_sha256 is null)
    or (selected_source<>'none' and selected_text_sha256 is not null and selected_score is not null)
  )
);

create index page_fusion_decisions_page_idx
  on public.page_fusion_decisions(source_page_id,created_at desc);
create index page_fusion_decisions_review_idx
  on public.page_fusion_decisions(status,created_at)
  where status='review_required';
create index page_fusion_decisions_output_idx
  on public.page_fusion_decisions(selected_engine_output_id)
  where selected_engine_output_id is not null;
create index page_fusion_decisions_pipeline_idx
  on public.page_fusion_decisions(pipeline_version_id);

alter table public.page_fusion_decisions enable row level security;
revoke all on public.page_fusion_decisions from public,anon,authenticated;
grant select,insert,update,delete on public.page_fusion_decisions to service_role;

comment on table public.page_fusion_decisions is
  'Immutable audited choice among page extraction candidates. Decisions do not overwrite canonical page text.';

