-- Durable, service-only orchestration and page diagnostics. Jobs are idempotent,
-- claimable with SKIP LOCKED, retryable and independent from browser sessions.

create table public.pipeline_versions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  component text not null,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration)='object'),
  code_revision text,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index pipeline_versions_one_active_component_idx
  on public.pipeline_versions(component) where active;

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('diagnose_document','diagnose_page','extract_page','ocr_page','analyze_layout','extract_tariff','extract_legal','build_context','quality_check')),
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  source_document_id uuid references public.source_documents(id) on delete cascade,
  source_page_id uuid references public.source_pages(id) on delete cascade,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  priority smallint not null default 50 check (priority between 0 and 100),
  status text not null default 'queued' check (status in ('queued','running','retry_wait','completed','failed','quarantined','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 20),
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_document_id is not null or source_page_id is not null)
);

create index ingestion_jobs_claim_idx on public.ingestion_jobs(status,scheduled_at,priority desc,created_at)
  where status in ('queued','retry_wait');
create index ingestion_jobs_document_idx on public.ingestion_jobs(source_document_id,job_type,status);
create index ingestion_jobs_page_idx on public.ingestion_jobs(source_page_id,job_type,status);

create table public.page_diagnostics (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  status text not null check (status in ('complete','incomplete','failed')),
  recommended_strategy text not null check (recommended_strategy in ('native_pdf','pdfium','ocr','vision','hybrid','quarantine')),
  detected_languages text[] not null default '{}',
  character_count integer not null default 0 check (character_count >= 0),
  word_count integer not null default 0 check (word_count >= 0),
  line_count integer not null default 0 check (line_count >= 0),
  digit_ratio numeric(6,5) check (digit_ratio between 0 and 1),
  replacement_character_count integer not null default 0 check (replacement_character_count >= 0),
  has_table_signals boolean not null default false,
  requires_ocr boolean not null default false,
  quality_score numeric(5,2) not null check (quality_score between 0 and 100),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics)='object'),
  created_at timestamptz not null default now(),
  unique(source_page_id,pipeline_version_id)
);

create index page_diagnostics_strategy_idx on public.page_diagnostics(recommended_strategy,quality_score);
create index page_diagnostics_ocr_idx on public.page_diagnostics(requires_ocr,quality_score) where requires_ocr;

create table public.page_engine_outputs (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  engine text not null,
  engine_version text not null,
  output_kind text not null check (output_kind in ('text','ocr','layout','table','vision')),
  text_content text,
  confidence numeric(5,2) check (confidence between 0 and 100),
  output_sha256 text not null check (output_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  unique(source_page_id,pipeline_version_id,engine,engine_version,output_kind,output_sha256)
);

create index page_engine_outputs_page_idx on public.page_engine_outputs(source_page_id,created_at desc);

create table public.page_blocks (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  engine_output_id uuid not null references public.page_engine_outputs(id) on delete cascade,
  parent_block_id uuid references public.page_blocks(id) on delete cascade,
  block_type text not null check (block_type in ('title','heading','paragraph','list','table','table_row','table_cell','header','footer','image','stamp','signature','other')),
  reading_order integer not null check (reading_order >= 0),
  text_content text,
  bbox jsonb not null check (jsonb_typeof(bbox)='object'),
  confidence numeric(5,2) check (confidence between 0 and 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);

create index page_blocks_order_idx on public.page_blocks(source_page_id,reading_order);
create index page_blocks_parent_idx on public.page_blocks(parent_block_id) where parent_block_id is not null;

alter table public.pipeline_versions enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.page_diagnostics enable row level security;
alter table public.page_engine_outputs enable row level security;
alter table public.page_blocks enable row level security;

revoke all on public.pipeline_versions,public.ingestion_jobs,public.page_diagnostics,public.page_engine_outputs,public.page_blocks from public,anon,authenticated;
grant select,insert,update,delete on public.pipeline_versions,public.ingestion_jobs,public.page_diagnostics,public.page_engine_outputs,public.page_blocks to service_role;

insert into public.pipeline_versions(id,component,configuration,code_revision,active)
values ('page-diagnostic-v1','page-diagnostic',jsonb_build_object('short_text_threshold',80,'ocr_priority',90),'ae822c5',true);

create or replace function public.claim_ingestion_jobs(worker_id text, accepted_types text[], batch_size integer default 10)
returns setof public.ingestion_jobs
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if worker_id is null or length(worker_id) not between 3 and 120 or batch_size not between 1 and 50 then
    raise exception 'invalid worker claim';
  end if;
  return query
  with candidates as (
    select id from public.ingestion_jobs
    where status in ('queued','retry_wait') and scheduled_at<=now()
      and (accepted_types is null or job_type=any(accepted_types))
    order by priority desc,scheduled_at,created_at
    for update skip locked limit batch_size
  )
  update public.ingestion_jobs j set status='running',attempts=j.attempts+1,
    locked_at=now(),locked_by=worker_id,heartbeat_at=now(),
    started_at=coalesce(j.started_at,now()),updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end; $$;

create or replace function public.complete_ingestion_job(job_id uuid, worker_id text, job_result jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.ingestion_jobs set status='completed',result=coalesce(job_result,'{}'::jsonb),
    completed_at=now(),heartbeat_at=now(),updated_at=now()
  where id=job_id and status='running' and locked_by=worker_id;
  return found;
end; $$;

create or replace function public.fail_ingestion_job(job_id uuid, worker_id text, error_code text, error_message text)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare next_status text;
begin
  select case when attempts>=max_attempts then 'quarantined' else 'retry_wait' end into next_status
  from public.ingestion_jobs where id=job_id and status='running' and locked_by=worker_id for update;
  if next_status is null then return null; end if;
  update public.ingestion_jobs set status=next_status,last_error_code=left(error_code,120),
    last_error_message=left(error_message,2000),scheduled_at=case when next_status='retry_wait'
      then now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)) else scheduled_at end,
    locked_at=null,locked_by=null,heartbeat_at=null,updated_at=now()
  where id=job_id;
  return next_status;
end; $$;

revoke all on function public.claim_ingestion_jobs(text,text[],integer) from public,anon,authenticated;
revoke all on function public.complete_ingestion_job(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_ingestion_job(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_ingestion_jobs(text,text[],integer) to service_role;
grant execute on function public.complete_ingestion_job(uuid,text,jsonb) to service_role;
grant execute on function public.fail_ingestion_job(uuid,text,text,text) to service_role;

-- Initial deterministic text-layer diagnostic. Geometry and image metrics are
-- added by the durable PDF worker without overwriting this revision.
insert into public.page_diagnostics(
  source_page_id,pipeline_version_id,status,recommended_strategy,detected_languages,
  character_count,word_count,line_count,digit_ratio,replacement_character_count,
  has_table_signals,requires_ocr,quality_score,metrics
)
select p.id,'page-diagnostic-v1','complete',
  case when length(trim(p.text_content))<80 then 'ocr' else 'native_pdf' end,
  case when p.text_content ~ '[؀-ۿ]' then array['ar']::text[] else array['fr']::text[] end,
  length(p.text_content),
  cardinality(regexp_split_to_array(trim(p.text_content),'\s+')),
  greatest(1,array_length(regexp_split_to_array(p.text_content,E'\n'),1)),
  case when length(p.text_content)=0 then 0 else length(regexp_replace(p.text_content,'[^0-9]','','g'))::numeric/length(p.text_content) end,
  length(p.text_content)-length(replace(p.text_content,'�','')),
  p.text_content ~ '(?i)(tarif des droits|désignation|unité|quotité|taux)',
  length(trim(p.text_content))<80,
  case when length(trim(p.text_content))<80 then 20 else least(90,55+ln(greatest(length(trim(p.text_content)),80))::numeric*5) end,
  jsonb_build_object('basis','existing_text_layer','source_extraction_method',p.extraction_method)
from public.source_pages p
on conflict(source_page_id,pipeline_version_id) do nothing;

insert into public.ingestion_jobs(job_type,pipeline_version_id,source_document_id,source_page_id,idempotency_key,payload,priority)
select 'ocr_page','page-diagnostic-v1',p.source_document_id,p.id,
  'ocr_page:'||p.id::text||':page-diagnostic-v1',jsonb_build_object('reason','short_text','page_number',p.page_number),90
from public.source_pages p join public.page_diagnostics d on d.source_page_id=p.id and d.pipeline_version_id='page-diagnostic-v1'
where d.requires_ocr
on conflict(idempotency_key) do nothing;

comment on table public.ingestion_jobs is 'Durable service-only job queue with idempotency, leases, retries and quarantine.';
comment on table public.page_diagnostics is 'Immutable page-level extraction strategy and quality metrics per pipeline version.';
