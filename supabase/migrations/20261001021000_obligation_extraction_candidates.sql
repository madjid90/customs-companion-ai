-- Candidate-only obligation extraction for authorization, control, document and
-- procedure sources. This is an ingestion layer, not canonical publication.

alter table public.ingestion_jobs
  drop constraint if exists ingestion_jobs_job_type_check;

alter table public.ingestion_jobs
  add constraint ingestion_jobs_job_type_check
  check (job_type in (
    'diagnose_document','diagnose_page','extract_page','ocr_page','analyze_layout',
    'extract_tariff','extract_legal','extract_obligation','build_context','quality_check'
  ));

insert into public.pipeline_versions(id, component, configuration, code_revision, active)
values (
  'obligation-extractor-v1',
  'obligation-extractor',
  jsonb_build_object(
    'mode','candidate_only',
    'signals', jsonb_build_array('authorization','technical_control','sanitary_control','required_document','procedure'),
    'canonical_fact_write', false
  ),
  'obligation-extractor-v1',
  true
)
on conflict(id) do update set
  configuration = excluded.configuration,
  code_revision = excluded.code_revision,
  active = excluded.active;

create table if not exists public.obligation_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  source_page_id uuid references public.source_pages(id) on delete set null,
  pipeline_version_id text not null references public.pipeline_versions(id) on delete restrict,
  input_text_sha256 text not null check (input_text_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'review_required' check (status in ('completed','review_required','rejected','failed')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  measure_types text[] not null default '{}',
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics)='object'),
  created_at timestamptz not null default now(),
  unique(source_document_id, pipeline_version_id, input_text_sha256)
);

create table if not exists public.regulatory_measure_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.obligation_extraction_runs(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  source_page_id uuid references public.source_pages(id) on delete set null,
  source_catalog_id uuid references public.source_catalog(id) on delete set null,
  measure_type text not null check (measure_type in ('prohibition','restriction','authorization','technical_control','sanitary_control','origin_rule','required_document','procedure','exemption','quota')),
  title text not null,
  description text not null,
  authority_name text,
  hs_code_raw text,
  hs_prefix text check (hs_prefix is null or hs_prefix ~ '^[0-9]{2,14}$'),
  operation text check (operation is null or operation in ('import','export','transit','import_export','unknown')),
  product_terms text[] not null default '{}',
  required_documents jsonb not null default '[]'::jsonb check (jsonb_typeof(required_documents)='array'),
  procedure_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(procedure_steps)='array'),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions)='object'),
  source_quote text not null,
  extraction_confidence numeric(5,2) not null check (extraction_confidence between 0 and 100),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  review_status text not null default 'proposed' check (review_status in ('proposed','validated','rejected')),
  publication_status text not null default 'candidate' check (publication_status in ('candidate','draft','published','rejected')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(extraction_run_id, evidence_sha256)
);

create index if not exists obligation_extraction_runs_status_idx
  on public.obligation_extraction_runs(status, created_at desc);
create index if not exists regulatory_measure_candidates_review_idx
  on public.regulatory_measure_candidates(review_status, measure_type, created_at desc);
create index if not exists regulatory_measure_candidates_hs_idx
  on public.regulatory_measure_candidates(hs_prefix, measure_type)
  where hs_prefix is not null;

alter table public.obligation_extraction_runs enable row level security;
alter table public.regulatory_measure_candidates enable row level security;

revoke all on public.obligation_extraction_runs, public.regulatory_measure_candidates from public, anon, authenticated;
grant select, insert, update, delete on public.obligation_extraction_runs, public.regulatory_measure_candidates to service_role;
grant select on public.obligation_extraction_runs, public.regulatory_measure_candidates to authenticated;

drop policy if exists obligation_extraction_runs_admin_read on public.obligation_extraction_runs;
create policy obligation_extraction_runs_admin_read on public.obligation_extraction_runs
for select to authenticated using (private.is_platform_admin());

drop policy if exists regulatory_measure_candidates_admin_read on public.regulatory_measure_candidates;
create policy regulatory_measure_candidates_admin_read on public.regulatory_measure_candidates
for select to authenticated using (private.is_platform_admin());

create or replace function private.obligation_measure_type(line_text text)
returns text language sql immutable as $$
  select case
    when coalesce(line_text,'') ~* '\m(interdit|interdiction|prohib)' then 'prohibition'
    when coalesce(line_text,'') ~* '\m(licence|autorisation|agrément|agrement|permis)\M' then 'authorization'
    when coalesce(line_text,'') ~* '\m(sanitaire|phytosanitaire|vétérinaire|veterinaire|onssa|certificat sanitaire)\M' then 'sanitary_control'
    when coalesce(line_text,'') ~* '\m(contrôle|controle|conformité|conformite|norme|marquage|inspection)\M' then 'technical_control'
    when coalesce(line_text,'') ~* '\m(document|pièce|piece|certificat|attestation|facture|liste de colisage|titre)\M' then 'required_document'
    when coalesce(line_text,'') ~* '\m(procédure|procedure|demande|dépôt|depot|portnet|badr|étape|etape)\M' then 'procedure'
    when coalesce(line_text,'') ~* '\m(quota|contingent)\M' then 'quota'
    when coalesce(line_text,'') ~* '\m(restriction|soumis|subordonné|subordonne)\M' then 'restriction'
    else null
  end
$$;

create or replace function private.obligation_operation(line_text text)
returns text language sql immutable as $$
  select case
    when coalesce(line_text,'') ~* '\m(importation|import|importer)\M' and coalesce(line_text,'') ~* '\m(exportation|export|exporter)\M' then 'import_export'
    when coalesce(line_text,'') ~* '\m(exportation|export|exporter)\M' then 'export'
    when coalesce(line_text,'') ~* '\m(transit)\M' then 'transit'
    when coalesce(line_text,'') ~* '\m(importation|import|importer)\M' then 'import'
    else 'unknown'
  end
$$;

create or replace function private.obligation_compact(input text)
returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(input,''), '[[:space:]]+', ' ', 'g'))
$$;

create or replace function private.obligation_sha256(input text)
returns text language sql immutable as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(input,''), 'UTF8')), 'hex')
$$;

create or replace function public.run_online_obligation_extraction_batch(batch_size integer default 10)
returns table(processed integer, completed integer, failed integer, remaining integer)
language plpgsql security definer set search_path = '' as $$
declare
  worker_id text := 'online-obligation-extractor';
  job public.ingestion_jobs%rowtype;
  page_record record;
  run_id uuid;
  line_record record;
  line_clean text;
  measure_type_value text;
  operation_value text;
  candidate_count_value integer;
  hs_match text[];
  hs_raw text;
  hs_prefix_value text;
  document_titles text[];
begin
  processed := 0; completed := 0; failed := 0;

  for job in select * from public.claim_ingestion_jobs(worker_id, array['extract_obligation'], greatest(1, least(coalesce(batch_size,10), 50))) loop
    processed := processed + 1;
    begin
      select p.id as source_page_id, p.source_document_id, p.text_content, p.text_sha256, p.page_number,
             d.source_catalog_id, d.title as document_title, d.document_type,
             sc.source_code, ac.display_name as authority_name
      into page_record
      from public.source_pages p
      join public.source_documents d on d.id = p.source_document_id
      left join public.source_catalog sc on sc.id = d.source_catalog_id
      left join public.authority_catalog ac on ac.id = sc.authority_id
      where p.id = job.source_page_id and p.review_status <> 'rejected';

      if page_record.source_page_id is null or private.obligation_compact(page_record.text_content) = '' then
        raise exception 'no_source_page';
      end if;

      insert into public.obligation_extraction_runs(source_document_id, source_page_id, pipeline_version_id, input_text_sha256, status, metrics)
      values(job.source_document_id, job.source_page_id, 'obligation-extractor-v1', page_record.text_sha256, 'review_required', jsonb_build_object('extraction_mode','postgres_online_obligation_v1'))
      on conflict(source_document_id, pipeline_version_id, input_text_sha256) do update
        set created_at = public.obligation_extraction_runs.created_at
      returning id into run_id;

      select count(*) into candidate_count_value from public.regulatory_measure_candidates where extraction_run_id = run_id;
      if candidate_count_value = 0 then
        for line_record in
          select line_text, line_index
          from regexp_split_to_table(page_record.text_content, E'[\n\r]+') with ordinality as line(line_text,line_index)
          order by line_index
        loop
          line_clean := private.obligation_compact(line_record.line_text);
          if length(line_clean) < 25 then continue; end if;
          measure_type_value := private.obligation_measure_type(line_clean);
          if measure_type_value is null then continue; end if;

          hs_match := regexp_match(line_clean, '(?<![0-9])([0-9]{4,10})(?![0-9])');
          hs_raw := case when hs_match is null then null else hs_match[1] end;
          hs_prefix_value := case when hs_raw is null then null else left(hs_raw, least(length(hs_raw), 10)) end;
          operation_value := private.obligation_operation(line_clean);
          document_titles := array_remove(array[
            case when line_clean ~* '\mcertificat\M' then 'certificat' end,
            case when line_clean ~* '\mfacture\M' then 'facture' end,
            case when line_clean ~* '\mattestation\M' then 'attestation' end,
            case when line_clean ~* '\mliste de colisage\M' then 'liste de colisage' end,
            case when line_clean ~* '\mtitre\M' then 'titre' end
          ], null);

          insert into public.regulatory_measure_candidates(
            extraction_run_id, source_document_id, source_page_id, source_catalog_id,
            measure_type, title, description, authority_name, hs_code_raw, hs_prefix,
            operation, product_terms, required_documents, procedure_steps, conditions,
            source_quote, extraction_confidence, evidence_sha256, metadata
          ) values (
            run_id, job.source_document_id, job.source_page_id, page_record.source_catalog_id,
            measure_type_value,
            left(coalesce(page_record.document_title,'Obligation') || ' — ' || measure_type_value, 240),
            line_clean,
            page_record.authority_name,
            hs_raw,
            hs_prefix_value,
            operation_value,
            '{}'::text[],
            coalesce((select jsonb_agg(value) from unnest(document_titles) as value), '[]'::jsonb),
            case when measure_type_value = 'procedure' then jsonb_build_array(line_clean) else '[]'::jsonb end,
            jsonb_build_object('source_code', page_record.source_code, 'page_number', page_record.page_number),
            line_clean,
            case when hs_prefix_value is not null then 78 when measure_type_value in ('authorization','technical_control','sanitary_control') then 72 else 62 end,
            private.obligation_sha256(job.source_document_id::text || ':' || page_record.page_number::text || ':' || line_record.line_index::text || ':' || line_clean),
            jsonb_build_object('extraction_mode','postgres_online_obligation_v1','canonical_fact_write',false)
          ) on conflict(extraction_run_id, evidence_sha256) do nothing;
        end loop;
      end if;

      select count(*) into candidate_count_value from public.regulatory_measure_candidates where extraction_run_id = run_id;
      update public.obligation_extraction_runs set
        status = case when candidate_count_value >= 1 then 'review_required' else 'rejected' end,
        candidate_count = candidate_count_value,
        measure_types = coalesce((select array_agg(distinct measure_type order by measure_type) from public.regulatory_measure_candidates where extraction_run_id = run_id), '{}'::text[]),
        quality_score = case when candidate_count_value >= 3 then 76 when candidate_count_value >= 1 then 58 else 15 end,
        metrics = jsonb_build_object('candidate_count', candidate_count_value, 'canonical_fact_write', false)
      where id = run_id;

      if candidate_count_value >= 1 then
        if not coalesce((select public.complete_ingestion_job(job.id, worker_id, jsonb_build_object('obligation_extraction_run_id', run_id, 'candidate_count', candidate_count_value))), false) then
          raise exception 'lease_lost';
        end if;
        completed := completed + 1;
      else
        perform public.fail_ingestion_job(job.id, worker_id, 'no_obligation_candidates', 'No obligation candidate detected in source page');
        failed := failed + 1;
      end if;
    exception when others then
      perform public.fail_ingestion_job(job.id, worker_id, SQLSTATE, SQLERRM);
      failed := failed + 1;
    end;
  end loop;

  select count(*) into remaining from public.ingestion_jobs where job_type='extract_obligation' and status in ('queued','retry_wait');
  return next;
end $$;

revoke all on function public.run_online_obligation_extraction_batch(integer) from public, anon, authenticated;
grant execute on function public.run_online_obligation_extraction_batch(integer) to service_role;
comment on function public.run_online_obligation_extraction_batch(integer) is 'Service-only candidate obligation extraction batch. Does not publish canonical regulatory measures.';

-- Keep the online processor moving without requiring a local terminal.
do $schedule$
declare existing_job bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for existing_job in select jobid from cron.job where jobname = 'douane-ai-online-obligation-extraction' loop
      perform cron.unschedule(existing_job);
    end loop;
    perform cron.schedule(
      'douane-ai-online-obligation-extraction',
      '* * * * *',
      $$select public.run_online_obligation_extraction_batch(10);$$
    );
  end if;
end $schedule$;

comment on table public.obligation_extraction_runs is 'Candidate-only extraction runs for regulatory obligations before canonical publication.';
comment on table public.regulatory_measure_candidates is 'Candidate obligations, authorizations, controls, documents and procedures extracted from official sources. Not canonical facts.';
