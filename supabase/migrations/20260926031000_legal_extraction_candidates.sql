-- REQ-04, REQ-05 and REQ-06: legal structure extraction remains candidate-only
-- until reviewed and promoted into canonical legal_instruments/legal_versions/legal_provisions.

create table public.legal_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  input_signature_sha256 text not null check (input_signature_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('completed','review_required','rejected','failed')),
  provision_count integer not null default 0 check (provision_count >= 0),
  article_count integer not null default 0 check (article_count >= 0 and article_count <= provision_count),
  relationship_count integer not null default 0 check (relationship_count >= 0),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics)='object'),
  created_at timestamptz not null default now(),
  unique(source_document_id,pipeline_version_id,input_signature_sha256)
);

create table public.legal_provision_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.legal_extraction_runs(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  source_page_id uuid references public.source_pages(id) on delete set null,
  provision_type text not null check (provision_type in ('book','title','chapter','section','article','paragraph','annex','table','definition','note')),
  number text,
  heading text,
  body_text text not null,
  hierarchy_path text not null,
  parent_hierarchy_path text,
  sequence_number integer not null check (sequence_number >= 0),
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end > 0),
  extraction_confidence numeric(5,2) not null check (extraction_confidence between 0 and 100),
  validation_status text not null default 'proposed' check (validation_status in ('proposed','needs_review','validated','rejected')),
  publication_status text not null default 'candidate' check (publication_status in ('candidate','ready','published','rejected')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(extraction_run_id,hierarchy_path),
  check (page_end is null or page_start is null or page_end >= page_start),
  check (publication_status <> 'ready' or validation_status='validated')
);

create table public.legal_relationship_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.legal_extraction_runs(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  source_page_id uuid references public.source_pages(id) on delete set null,
  relationship_index integer not null check (relationship_index >= 0),
  reference_type text not null check (reference_type in ('circular','legal_instrument','article','other')),
  reference_raw text not null,
  reference_normalized text not null,
  relationship_type text not null check (relationship_type in ('mentions','amends','repeals','replaces','implements','interprets','complements','corrects','suspends','extends','creates_exception')),
  evidence_text text not null,
  effective_date_text text,
  effective_from date,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  validation_status text not null default 'proposed' check (validation_status in ('proposed','needs_review','validated','rejected')),
  publication_status text not null default 'candidate' check (publication_status in ('candidate','ready','published','rejected')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(extraction_run_id,relationship_index),
  check (publication_status <> 'ready' or validation_status='validated')
);

create index legal_extraction_runs_document_idx on public.legal_extraction_runs(source_document_id,created_at desc);
create index legal_provision_candidates_review_idx on public.legal_provision_candidates(publication_status,validation_status,provision_type);
create index legal_provision_candidates_path_idx on public.legal_provision_candidates(source_document_id,hierarchy_path);
create index legal_relationship_candidates_ref_idx on public.legal_relationship_candidates(reference_normalized,relationship_type,validation_status);

alter table public.legal_extraction_runs enable row level security;
alter table public.legal_provision_candidates enable row level security;
alter table public.legal_relationship_candidates enable row level security;

revoke all on public.legal_extraction_runs,public.legal_provision_candidates,public.legal_relationship_candidates from public,anon,authenticated;
grant select,insert,update,delete on public.legal_extraction_runs,public.legal_provision_candidates,public.legal_relationship_candidates to service_role;

update public.pipeline_versions set active=false where component='legal-structure-extractor';
insert into public.pipeline_versions(id,component,configuration,code_revision,active)
values ('legal-structure-extractor-v1','legal-structure-extractor',jsonb_build_object(
  'jurisdiction_agnostic',true,
  'publication_mode','candidate_only',
  'provision_types',jsonb_build_array('book','title','chapter','section','article','paragraph','annex'),
  'relationship_candidates',jsonb_build_array('mentions','amends','repeals','replaces','implements','complements','suspends')
),'legal-structure-extractor-v1',true);

insert into public.ingestion_jobs(job_type,pipeline_version_id,source_document_id,idempotency_key,payload,priority)
select 'extract_legal','legal-structure-extractor-v1',d.id,
  'extract_legal:'||d.id::text||':legal-structure-extractor-v1:'||coalesce(d.sha256,'missing'),
  jsonb_build_object('document_type',d.document_type,'sha256',d.sha256,'page_count',count(p.id)),70
from public.source_documents d
join public.source_pages p on p.source_document_id=d.id
where d.document_type in ('customs_code','law','decree','order','circular','instruction','agreement','origin_rule','procedure','authorization','technical_control','tax_rule')
  and length(trim(p.text_content))>=40
  and d.lifecycle_status <> 'rejected'
group by d.id,d.document_type,d.sha256
on conflict(idempotency_key) do nothing;

comment on table public.legal_extraction_runs is 'Immutable legal structure extraction result for one source document revision.';
comment on table public.legal_provision_candidates is 'Unpublished legal hierarchy candidates with page-level evidence.';
comment on table public.legal_relationship_candidates is 'Unpublished legal relationship candidates extracted from legal text.';
