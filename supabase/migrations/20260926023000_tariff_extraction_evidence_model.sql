-- REQ-02, REQ-03 and REQ-06: candidate tariff tables, rows and cells remain
-- separate from canonical HS/tariff facts and retain page-level evidence.

create table public.tariff_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  input_text_sha256 text not null check (input_text_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('completed','review_required','rejected','failed')),
  table_count integer not null default 0 check (table_count >= 0),
  row_count integer not null default 0 check (row_count >= 0),
  valid_row_count integer not null default 0 check (valid_row_count >= 0 and valid_row_count <= row_count),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics)='object'),
  created_at timestamptz not null default now(),
  unique(source_page_id,pipeline_version_id,input_text_sha256)
);

create table public.tariff_table_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.tariff_extraction_runs(id) on delete cascade,
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  source_block_id uuid references public.page_blocks(id) on delete set null,
  table_index integer not null check (table_index >= 0),
  header_map jsonb not null default '{}'::jsonb check (jsonb_typeof(header_map)='object'),
  bbox jsonb check (bbox is null or jsonb_typeof(bbox)='object'),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  status text not null default 'proposed' check (status in ('proposed','accepted','ambiguous','rejected')),
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(extraction_run_id,table_index)
);

create table public.tariff_row_candidates (
  id uuid primary key default gen_random_uuid(),
  table_candidate_id uuid not null references public.tariff_table_candidates(id) on delete cascade,
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  raw_text text not null,
  raw_text_sha256 text not null check (raw_text_sha256 ~ '^[a-f0-9]{64}$'),
  hs_code_raw text,
  hs_code_normalized text check (hs_code_normalized is null or hs_code_normalized ~ '^[0-9]{4}([0-9]{2}){0,3}$'),
  hs_level text check (hs_level is null or hs_level in ('heading','subheading','national_line')),
  designation text,
  unit_code text,
  duty_rate_raw text,
  duty_rate numeric,
  vat_rate_raw text,
  vat_rate numeric,
  regime text,
  notes text,
  parent_row_id uuid references public.tariff_row_candidates(id) on delete set null,
  bbox jsonb check (bbox is null or jsonb_typeof(bbox)='object'),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  validation_status text not null default 'proposed' check (validation_status in ('proposed','valid','ambiguous','invalid')),
  validation_codes text[] not null default '{}',
  publication_status text not null default 'candidate' check (publication_status in ('candidate','ready','published','rejected')),
  created_at timestamptz not null default now(),
  unique(table_candidate_id,row_index),
  check (duty_rate is null or duty_rate between 0 and 1000),
  check (vat_rate is null or vat_rate between 0 and 1000),
  check (publication_status <> 'ready' or (validation_status='valid' and hs_code_normalized is not null and designation is not null))
);

create table public.tariff_cell_evidence (
  id uuid primary key default gen_random_uuid(),
  row_candidate_id uuid not null references public.tariff_row_candidates(id) on delete cascade,
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  source_block_id uuid references public.page_blocks(id) on delete set null,
  column_name text not null check (column_name in ('hs_code','designation','unit','duty_rate','vat_rate','regime','notes','other')),
  column_index integer not null check (column_index >= 0),
  raw_value text not null,
  normalized_value text,
  bbox jsonb check (bbox is null or jsonb_typeof(bbox)='object'),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(row_candidate_id,column_index)
);

create index tariff_extraction_runs_page_idx on public.tariff_extraction_runs(source_page_id,created_at desc);
create index tariff_tables_page_idx on public.tariff_table_candidates(source_page_id,status);
create index tariff_rows_hs_idx on public.tariff_row_candidates(hs_code_normalized,validation_status) where hs_code_normalized is not null;
create index tariff_rows_review_idx on public.tariff_row_candidates(publication_status,validation_status,confidence);
create index tariff_cells_row_idx on public.tariff_cell_evidence(row_candidate_id,column_index);

alter table public.tariff_extraction_runs enable row level security;
alter table public.tariff_table_candidates enable row level security;
alter table public.tariff_row_candidates enable row level security;
alter table public.tariff_cell_evidence enable row level security;

revoke all on public.tariff_extraction_runs,public.tariff_table_candidates,public.tariff_row_candidates,public.tariff_cell_evidence from public,anon,authenticated;
grant select,insert,update,delete on public.tariff_extraction_runs,public.tariff_table_candidates,public.tariff_row_candidates,public.tariff_cell_evidence to service_role;

update public.pipeline_versions set active=false where component='tariff-extractor';
insert into public.pipeline_versions(id,component,configuration,code_revision,active)
values ('tariff-extractor-v2','tariff-extractor',jsonb_build_object(
  'jurisdiction_agnostic',true,
  'accepted_code_lengths',jsonb_build_array(4,6,8,10),
  'required_columns',jsonb_build_array('hs_code','designation'),
  'optional_columns',jsonb_build_array('unit','duty_rate','vat_rate','regime','notes'),
  'publication_mode','candidate_only'
),'tariff-extractor-v2',true);

insert into public.ingestion_jobs(job_type,pipeline_version_id,source_document_id,source_page_id,idempotency_key,payload,priority)
select 'extract_tariff','tariff-extractor-v2',d.id,p.id,
  'extract_tariff:'||p.id::text||':tariff-extractor-v2:'||p.text_sha256,
  jsonb_build_object('page_number',p.page_number,'input_text_sha256',p.text_sha256,'document_type',d.document_type),75
from public.source_documents d
join public.source_pages p on p.source_document_id=d.id
where d.document_type in ('tariff','hs_nomenclature')
  and length(trim(p.text_content))>=80
on conflict(idempotency_key) do nothing;

comment on table public.tariff_extraction_runs is 'Immutable tariff extraction result for one canonical page revision.';
comment on table public.tariff_row_candidates is 'Unpublished tariff row candidates with deterministic validation state.';
comment on table public.tariff_cell_evidence is 'Cell-level source evidence, geometry and normalized value for tariff candidates.';
