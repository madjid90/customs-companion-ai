-- Douane AI: versioned Moroccan customs knowledge foundation.
-- This migration intentionally starts with manual source deposits. Collection
-- automation can be added later without changing the legal/domain model.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = 'admin'
  );
$$;

revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated, service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  country_code text not null default 'MA' check (country_code ~ '^[A-Z]{2}$'),
  organization_type text not null default 'importer'
    check (organization_type in ('importer','exporter','broker','carrier','consultancy','authority','other')),
  status text not null default 'active' check (status in ('active','suspended','archived')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'analyst' check (role in ('owner','admin','expert','analyst','viewer')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members(user_id, status);

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = (select auth.uid())
      and om.status = 'active'
  );
$$;

create or replace function private.has_org_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = (select auth.uid())
      and om.status = 'active'
      and om.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, text[]) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;

-- Registry and immutable source revisions -----------------------------------

create table public.regulatory_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,50}$'),
  name text not null,
  authority_name text not null,
  jurisdiction_code text not null default 'MA',
  source_type text not null check (source_type in ('official_website','official_gazette','licensed_corpus','manual_official_copy','internal_reference')),
  acquisition_mode text not null default 'manual_upload' check (acquisition_mode in ('manual_upload','rss_notice','licensed_import')),
  base_url text,
  rss_url text,
  reuse_status text not null default 'review_required' check (reuse_status in ('authorized','review_required','restricted')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_sources(id) on delete restrict,
  parent_document_id uuid references public.source_documents(id) on delete set null,
  official_reference text,
  title text not null,
  document_type text not null check (document_type in ('customs_code','law','decree','order','circular','instruction','tariff','hs_nomenclature','section_note','chapter_note','classification_opinion','agreement','origin_rule','procedure','authorization','technical_control','tax_rule','guide','other')),
  language_code text not null default 'fr' check (language_code in ('fr','ar','en')),
  publication_date date,
  effective_from date,
  effective_to date,
  source_url text,
  storage_bucket text not null default 'legal-source-pdfs',
  storage_path text not null,
  mime_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  revision_number integer not null default 1 check (revision_number > 0),
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft','extracted','quality_review','legal_review','published','rejected','superseded')),
  supersedes_document_id uuid references public.source_documents(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, sha256),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check ((lifecycle_status <> 'published') or (published_at is not null and published_by is not null))
);

create index source_documents_status_idx on public.source_documents(lifecycle_status, document_type);
create index source_documents_reference_idx on public.source_documents(official_reference);
create index source_documents_effective_idx on public.source_documents(effective_from, effective_to);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  pipeline_version text not null,
  extraction_method text not null check (extraction_method in ('native_pdf','ocr','vision','html','spreadsheet','hybrid')),
  status text not null default 'queued' check (status in ('queued','processing','quality_review','completed','failed','cancelled')),
  total_pages integer check (total_pages is null or total_pages >= 0),
  processed_pages integer not null default 0 check (processed_pages >= 0),
  failed_pages integer not null default 0 check (failed_pages >= 0),
  extracted_articles integer not null default 0 check (extracted_articles >= 0),
  extracted_hs_codes integer not null default 0 check (extracted_hs_codes >= 0),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  extraction_hash text check (extraction_hash is null or extraction_hash ~ '^[a-f0-9]{64}$'),
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (total_pages is null or processed_pages <= total_pages),
  check (total_pages is null or failed_pages <= total_pages)
);

create table public.ingestion_issues (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references public.ingestion_runs(id) on delete cascade,
  page_number integer check (page_number is null or page_number > 0),
  issue_type text not null check (issue_type in ('missing_page','empty_page','ocr_noise','broken_hierarchy','invalid_hs_code','orphan_hs_code','table_alignment','missing_date','unresolved_reference','duplicate','content_conflict','other')),
  severity text not null check (severity in ('info','warning','blocking')),
  status text not null default 'open' check (status in ('open','resolved','accepted','dismissed')),
  description text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  resolution text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index ingestion_issues_queue_idx on public.ingestion_issues(status, severity, issue_type);

-- Versioned legal corpus ----------------------------------------------------

create table public.legal_instruments (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_code text not null default 'MA',
  instrument_type text not null check (instrument_type in ('constitution','treaty','agreement','law','customs_code','decree','order','circular','instruction','decision','procedure','guide')),
  official_reference text not null,
  canonical_title text not null,
  issuing_authority text not null,
  authority_rank smallint not null check (authority_rank between 1 and 100),
  status text not null default 'active' check (status in ('draft','active','partially_repealed','repealed','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jurisdiction_code, instrument_type, official_reference)
);

create table public.legal_versions (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.legal_instruments(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete restrict,
  version_label text not null,
  publication_date date,
  effective_from date,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','review','published','superseded','rejected')),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  applicability_notes text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (instrument_id, content_hash),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check ((status <> 'published') or (approved_by is not null and approved_at is not null))
);

create index legal_versions_applicability_idx on public.legal_versions(instrument_id, effective_from, effective_to, status);

create table public.legal_provisions (
  id uuid primary key default gen_random_uuid(),
  legal_version_id uuid not null references public.legal_versions(id) on delete cascade,
  parent_id uuid references public.legal_provisions(id) on delete cascade,
  provision_type text not null check (provision_type in ('book','title','chapter','section','article','paragraph','annex','table','definition','note')),
  number text,
  heading text,
  body_text text not null,
  hierarchy_path text not null,
  sequence_number integer not null check (sequence_number >= 0),
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end > 0),
  source_bbox jsonb,
  extraction_confidence numeric(5,2) check (extraction_confidence between 0 and 100),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','needs_review','validated','rejected')),
  created_at timestamptz not null default now(),
  unique (legal_version_id, hierarchy_path),
  check (page_end is null or page_start is null or page_end >= page_start)
);

create index legal_provisions_parent_idx on public.legal_provisions(parent_id, sequence_number);
create index legal_provisions_article_idx on public.legal_provisions(provision_type, number);

create table public.legal_relationships (
  id uuid primary key default gen_random_uuid(),
  source_instrument_id uuid not null references public.legal_instruments(id) on delete cascade,
  source_provision_id uuid references public.legal_provisions(id) on delete cascade,
  target_instrument_id uuid not null references public.legal_instruments(id) on delete cascade,
  target_provision_id uuid references public.legal_provisions(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('amends','repeals','replaces','implements','interprets','complements','corrects','suspends','extends','references','creates_exception')),
  effective_from date,
  effective_to date,
  evidence_text text not null,
  evidence_provision_id uuid references public.legal_provisions(id) on delete restrict,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  validation_status text not null default 'proposed' check (validation_status in ('proposed','validated','rejected')),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_instrument_id <> target_instrument_id or source_provision_id is distinct from target_provision_id),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check ((validation_status <> 'validated') or (validated_by is not null and validated_at is not null))
);

create index legal_relationships_source_idx on public.legal_relationships(source_instrument_id, relationship_type);
create index legal_relationships_target_idx on public.legal_relationships(target_instrument_id, relationship_type);

-- Versioned HS tree and regulatory context ---------------------------------

create table public.hs_nomenclatures (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  jurisdiction_code text not null,
  edition text not null,
  digits smallint not null check (digits between 2 and 14),
  effective_from date not null,
  effective_to date,
  source_document_id uuid references public.source_documents(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','review','published','superseded')),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.hs_nodes (
  id uuid primary key default gen_random_uuid(),
  nomenclature_id uuid not null references public.hs_nomenclatures(id) on delete cascade,
  parent_id uuid references public.hs_nodes(id) on delete restrict,
  code text not null check (code ~ '^[0-9]{2,14}$'),
  level text not null check (level in ('section','chapter','heading','subheading','national_line')),
  description_official text not null,
  description_resolved text not null,
  section_number text,
  chapter_number text not null check (chapter_number ~ '^[0-9]{2}$'),
  sequence_number integer not null check (sequence_number >= 0),
  source_provision_id uuid references public.legal_provisions(id) on delete set null,
  source_page integer check (source_page is null or source_page > 0),
  source_bbox jsonb,
  extraction_confidence numeric(5,2) check (extraction_confidence between 0 and 100),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','needs_review','validated','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nomenclature_id, code)
);

create index hs_nodes_parent_idx on public.hs_nodes(nomenclature_id, parent_id, sequence_number);
create index hs_nodes_chapter_idx on public.hs_nodes(nomenclature_id, chapter_number, code);

create table public.regulatory_measures (
  id uuid primary key default gen_random_uuid(),
  measure_type text not null check (measure_type in ('duty','vat','tic','prohibition','restriction','authorization','technical_control','sanitary_control','origin_rule','required_document','procedure','exemption','quota')),
  title text not null,
  description text not null,
  authority_name text,
  hs_node_id uuid references public.hs_nodes(id) on delete cascade,
  hs_prefix text check (hs_prefix is null or hs_prefix ~ '^[0-9]{2,14}$'),
  legal_provision_id uuid not null references public.legal_provisions(id) on delete restrict,
  country_origin text,
  country_destination text default 'MA',
  effective_from date,
  effective_to date,
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  validation_status text not null default 'proposed' check (validation_status in ('proposed','validated','rejected')),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hs_node_id is not null or hs_prefix is not null),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check ((validation_status <> 'validated') or (validated_by is not null and validated_at is not null))
);

create index regulatory_measures_hs_idx on public.regulatory_measures(hs_node_id, hs_prefix, measure_type);
create index regulatory_measures_effective_idx on public.regulatory_measures(effective_from, effective_to, validation_status);

create table public.business_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null,
  version integer not null default 1 check (version > 0),
  name text not null,
  description text not null,
  priority integer not null default 100,
  conditions jsonb not null check (jsonb_typeof(conditions) = 'object'),
  outcomes jsonb not null check (jsonb_typeof(outcomes) = 'object'),
  legal_provision_id uuid not null references public.legal_provisions(id) on delete restrict,
  effective_from date,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','review','published','retired')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rule_code, version),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check ((status <> 'published') or (approved_by is not null and approved_at is not null))
);

-- Tenant dossiers and reusable product memory -------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text,
  name text not null,
  brand text,
  model text,
  status text not null default 'active' check (status in ('active','review_required','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, sku)
);

create table public.product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  version integer not null check (version > 0),
  description text not null,
  characteristics jsonb not null default '{}'::jsonb check (jsonb_typeof(characteristics) = 'object'),
  composition text,
  intended_use text,
  supplier_name text,
  country_of_origin text,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (product_id, version),
  unique (product_id, content_hash),
  check (valid_to is null or valid_to >= valid_from)
);

create table public.customs_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  operation_type text not null check (operation_type in ('import','export','transit')),
  status text not null default 'draft' check (status in ('draft','documents_pending','analysis','expert_review','blocked','ready','closed','archived')),
  title text not null,
  origin_country text,
  destination_country text not null default 'MA',
  supplier_name text,
  importer_exporter_name text,
  incoterm text,
  operation_date date,
  currency text,
  total_value numeric,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference),
  check (total_value is null or total_value >= 0)
);

create index customs_cases_queue_idx on public.customs_cases(organization_id, status, updated_at desc);

create table public.case_items (
  id uuid primary key default gen_random_uuid(),
  customs_case_id uuid not null references public.customs_cases(id) on delete cascade,
  product_version_id uuid references public.product_versions(id) on delete set null,
  line_number integer not null check (line_number > 0),
  description text not null,
  quantity numeric check (quantity is null or quantity >= 0),
  unit text,
  unit_value numeric check (unit_value is null or unit_value >= 0),
  extracted_characteristics jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted_characteristics) = 'object'),
  status text not null default 'needs_classification' check (status in ('needs_information','needs_classification','classified','review_required','validated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customs_case_id, line_number)
);

create table public.case_documents (
  id uuid primary key default gen_random_uuid(),
  customs_case_id uuid not null references public.customs_cases(id) on delete cascade,
  document_type text not null check (document_type in ('invoice','packing_list','technical_sheet','catalogue','photo','certificate_of_origin','transport_document','authorization','declaration','other')),
  title text not null,
  storage_bucket text not null,
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  extraction_status text not null default 'pending' check (extraction_status in ('pending','processing','completed','failed','review_required')),
  extracted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted_data) = 'object'),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (customs_case_id, sha256)
);

create table public.classification_decisions (
  id uuid primary key default gen_random_uuid(),
  case_item_id uuid not null references public.case_items(id) on delete cascade,
  hs_node_id uuid not null references public.hs_nodes(id) on delete restrict,
  status text not null default 'proposed' check (status in ('proposed','needs_information','expert_review','validated','rejected','superseded')),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  rationale text not null,
  assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(assumptions) = 'array'),
  missing_information jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_information) = 'array'),
  engine_version text not null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status <> 'validated') or (decided_by is not null and decided_at is not null))
);

create index classification_decisions_item_idx on public.classification_decisions(case_item_id, created_at desc);

create table public.classification_candidates (
  id uuid primary key default gen_random_uuid(),
  classification_decision_id uuid not null references public.classification_decisions(id) on delete cascade,
  hs_node_id uuid not null references public.hs_nodes(id) on delete restrict,
  rank integer not null check (rank > 0),
  score numeric(5,2) not null check (score between 0 and 100),
  supporting_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(supporting_reasons) = 'array'),
  excluding_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(excluding_reasons) = 'array'),
  unique (classification_decision_id, hs_node_id),
  unique (classification_decision_id, rank)
);

create table public.classification_evidence (
  id uuid primary key default gen_random_uuid(),
  classification_decision_id uuid not null references public.classification_decisions(id) on delete cascade,
  legal_provision_id uuid references public.legal_provisions(id) on delete restrict,
  regulatory_measure_id uuid references public.regulatory_measures(id) on delete restrict,
  evidence_type text not null check (evidence_type in ('gri','section_note','chapter_note','heading_text','exclusion','classification_opinion','circular','technical_fact','other')),
  quotation text not null,
  explanation text not null,
  sequence_number integer not null default 0,
  check (legal_provision_id is not null or regulatory_measure_id is not null or evidence_type = 'technical_fact')
);

create table public.expert_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  review_type text not null check (review_type in ('source_document','legal_version','legal_relationship','hs_node','regulatory_measure','business_rule','classification_decision','generated_document')),
  entity_id uuid not null,
  decision text not null check (decision in ('approved','changes_requested','rejected')),
  comment text,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  review_snapshot jsonb not null check (jsonb_typeof(review_snapshot) = 'object')
);

create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customs_case_id uuid not null references public.customs_cases(id) on delete cascade,
  document_type text not null check (document_type in ('classification_note','customs_product_sheet','legal_analysis','import_checklist','export_checklist','authorization_analysis','tax_simulation','origin_note','broker_instructions','risk_report','evidence_bundle','circular_impact_report')),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','review','approved','superseded')),
  structured_content jsonb not null check (jsonb_typeof(structured_content) = 'object'),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'array'),
  storage_bucket text,
  storage_path text,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  generated_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (customs_case_id, document_type, version),
  check ((status <> 'approved') or (approved_by is not null and approved_at is not null))
);

create table public.customs_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index customs_audit_events_org_idx on public.customs_audit_events(organization_id, created_at desc);

-- RLS and least-privilege grants -------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.regulatory_sources enable row level security;
alter table public.source_documents enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.ingestion_issues enable row level security;
alter table public.legal_instruments enable row level security;
alter table public.legal_versions enable row level security;
alter table public.legal_provisions enable row level security;
alter table public.legal_relationships enable row level security;
alter table public.hs_nomenclatures enable row level security;
alter table public.hs_nodes enable row level security;
alter table public.regulatory_measures enable row level security;
alter table public.business_rules enable row level security;
alter table public.products enable row level security;
alter table public.product_versions enable row level security;
alter table public.customs_cases enable row level security;
alter table public.case_items enable row level security;
alter table public.case_documents enable row level security;
alter table public.classification_decisions enable row level security;
alter table public.classification_candidates enable row level security;
alter table public.classification_evidence enable row level security;
alter table public.expert_reviews enable row level security;
alter table public.generated_documents enable row level security;
alter table public.customs_audit_events enable row level security;

revoke all on table public.organizations, public.organization_members,
  public.regulatory_sources, public.source_documents, public.ingestion_runs,
  public.ingestion_issues, public.legal_instruments, public.legal_versions,
  public.legal_provisions, public.legal_relationships, public.hs_nomenclatures,
  public.hs_nodes, public.regulatory_measures, public.business_rules,
  public.products, public.product_versions, public.customs_cases, public.case_items,
  public.case_documents, public.classification_decisions, public.classification_candidates,
  public.classification_evidence, public.expert_reviews, public.generated_documents,
  public.customs_audit_events
from anon, authenticated;

grant select, insert, update, delete on public.organizations, public.organization_members,
  public.products, public.product_versions, public.customs_cases, public.case_items,
  public.case_documents, public.classification_decisions, public.classification_candidates,
  public.classification_evidence, public.expert_reviews, public.generated_documents
to authenticated;
grant select on public.regulatory_sources, public.source_documents, public.legal_instruments,
  public.legal_versions, public.legal_provisions, public.legal_relationships,
  public.hs_nomenclatures, public.hs_nodes, public.regulatory_measures, public.business_rules
to authenticated;
grant select on public.customs_audit_events to authenticated;
grant usage, select on sequence public.customs_audit_events_id_seq to authenticated;

create policy organizations_select on public.organizations for select to authenticated
using (private.is_org_member(id));
create policy organizations_insert on public.organizations for insert to authenticated
with check ((select auth.uid()) = created_by or private.is_platform_admin());
create policy organizations_update on public.organizations for update to authenticated
using (private.has_org_role(id, array['owner','admin']))
with check (private.has_org_role(id, array['owner','admin']));
create policy organizations_delete on public.organizations for delete to authenticated
using (private.has_org_role(id, array['owner']));

create policy organization_members_select on public.organization_members for select to authenticated
using (private.is_org_member(organization_id));
create policy organization_members_insert on public.organization_members for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner','admin'])
  or (
    user_id = (select auth.uid())
    and role = 'owner'
    and exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.created_by = (select auth.uid())
    )
    and not exists (
      select 1 from public.organization_members existing
      where existing.organization_id = organization_members.organization_id
    )
  )
);
create policy organization_members_update on public.organization_members for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin']))
with check (private.has_org_role(organization_id, array['owner','admin']));
create policy organization_members_delete on public.organization_members for delete to authenticated
using (private.has_org_role(organization_id, array['owner','admin']));

-- Published regulatory knowledge is readable by signed-in users. Drafts and
-- ingestion internals stay restricted to platform admins/service workers.
create policy regulatory_sources_read on public.regulatory_sources for select to authenticated
using (active or private.is_platform_admin());
create policy source_documents_read on public.source_documents for select to authenticated
using (lifecycle_status = 'published' or private.is_platform_admin());
create policy legal_instruments_read on public.legal_instruments for select to authenticated
using (status in ('active','partially_repealed','repealed') or private.is_platform_admin());
create policy legal_versions_read on public.legal_versions for select to authenticated
using (status in ('published','superseded') or private.is_platform_admin());
create policy legal_provisions_read on public.legal_provisions for select to authenticated
using (exists (select 1 from public.legal_versions lv where lv.id = legal_version_id and (lv.status in ('published','superseded') or private.is_platform_admin())));
create policy legal_relationships_read on public.legal_relationships for select to authenticated
using (validation_status = 'validated' or private.is_platform_admin());
create policy hs_nomenclatures_read on public.hs_nomenclatures for select to authenticated
using (status in ('published','superseded') or private.is_platform_admin());
create policy hs_nodes_read on public.hs_nodes for select to authenticated
using (review_status = 'validated' or private.is_platform_admin());
create policy regulatory_measures_read on public.regulatory_measures for select to authenticated
using (validation_status = 'validated' or private.is_platform_admin());
create policy business_rules_read on public.business_rules for select to authenticated
using (status = 'published' or private.is_platform_admin());

create policy products_select on public.products for select to authenticated
using (private.is_org_member(organization_id));
create policy products_insert on public.products for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin','expert','analyst']) and created_by = (select auth.uid()));
create policy products_update on public.products for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','expert','analyst']))
with check (private.has_org_role(organization_id, array['owner','admin','expert','analyst']));
create policy products_delete on public.products for delete to authenticated
using (private.has_org_role(organization_id, array['owner','admin']));

create policy product_versions_select on public.product_versions for select to authenticated
using (exists (select 1 from public.products p where p.id = product_id and private.is_org_member(p.organization_id)));
create policy product_versions_insert on public.product_versions for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.products p where p.id = product_id and private.has_org_role(p.organization_id, array['owner','admin','expert','analyst'])));
create policy product_versions_update on public.product_versions for update to authenticated
using (exists (select 1 from public.products p where p.id = product_id and private.has_org_role(p.organization_id, array['owner','admin','expert'])))
with check (exists (select 1 from public.products p where p.id = product_id and private.has_org_role(p.organization_id, array['owner','admin','expert'])));
create policy product_versions_delete on public.product_versions for delete to authenticated
using (exists (select 1 from public.products p where p.id = product_id and private.has_org_role(p.organization_id, array['owner','admin'])));

create policy customs_cases_select on public.customs_cases for select to authenticated
using (private.is_org_member(organization_id));
create policy customs_cases_insert on public.customs_cases for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin','expert','analyst']) and created_by = (select auth.uid()));
create policy customs_cases_update on public.customs_cases for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','expert','analyst']))
with check (private.has_org_role(organization_id, array['owner','admin','expert','analyst']));
create policy customs_cases_delete on public.customs_cases for delete to authenticated
using (private.has_org_role(organization_id, array['owner','admin']));

-- Child tenant tables inherit access through their dossier or organization.
create policy case_items_select on public.case_items for select to authenticated
using (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.is_org_member(c.organization_id)))
;
create policy case_items_insert on public.case_items for insert to authenticated
with check (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy case_items_update on public.case_items for update to authenticated
using (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])))
with check (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy case_items_delete on public.case_items for delete to authenticated
using (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin'])));
create policy case_documents_select on public.case_documents for select to authenticated
using (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.is_org_member(c.organization_id)))
;
create policy case_documents_insert on public.case_documents for insert to authenticated
with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy case_documents_update on public.case_documents for update to authenticated
using (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])))
with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy case_documents_delete on public.case_documents for delete to authenticated
using (exists (select 1 from public.customs_cases c where c.id = customs_case_id and private.has_org_role(c.organization_id, array['owner','admin'])));
create policy classification_decisions_select on public.classification_decisions for select to authenticated
using (exists (select 1 from public.case_items ci join public.customs_cases c on c.id = ci.customs_case_id where ci.id = case_item_id and private.is_org_member(c.organization_id)))
;
create policy classification_decisions_insert on public.classification_decisions for insert to authenticated
with check (exists (select 1 from public.case_items ci join public.customs_cases c on c.id = ci.customs_case_id where ci.id = case_item_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy classification_decisions_update on public.classification_decisions for update to authenticated
using (exists (select 1 from public.case_items ci join public.customs_cases c on c.id = ci.customs_case_id where ci.id = case_item_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])))
with check (exists (select 1 from public.case_items ci join public.customs_cases c on c.id = ci.customs_case_id where ci.id = case_item_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy classification_decisions_delete on public.classification_decisions for delete to authenticated
using (exists (select 1 from public.case_items ci join public.customs_cases c on c.id = ci.customs_case_id where ci.id = case_item_id and private.has_org_role(c.organization_id, array['owner','admin'])));
create policy classification_candidates_select on public.classification_candidates for select to authenticated
using (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.is_org_member(c.organization_id)))
;
create policy classification_candidates_insert on public.classification_candidates for insert to authenticated
with check (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy classification_candidates_update on public.classification_candidates for update to authenticated
using (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])))
with check (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy classification_candidates_delete on public.classification_candidates for delete to authenticated
using (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin'])));
create policy classification_evidence_select on public.classification_evidence for select to authenticated
using (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.is_org_member(c.organization_id)))
;
create policy classification_evidence_insert on public.classification_evidence for insert to authenticated
with check (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy classification_evidence_update on public.classification_evidence for update to authenticated
using (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])))
with check (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin','expert','analyst'])));
create policy classification_evidence_delete on public.classification_evidence for delete to authenticated
using (exists (select 1 from public.classification_decisions cd join public.case_items ci on ci.id = cd.case_item_id join public.customs_cases c on c.id = ci.customs_case_id where cd.id = classification_decision_id and private.has_org_role(c.organization_id, array['owner','admin'])));
create policy expert_reviews_select on public.expert_reviews for select to authenticated
using ((organization_id is null and private.is_platform_admin()) or (organization_id is not null and private.is_org_member(organization_id)));
create policy expert_reviews_insert on public.expert_reviews for insert to authenticated
with check (reviewed_by = (select auth.uid()) and ((organization_id is null and private.is_platform_admin()) or (organization_id is not null and private.has_org_role(organization_id, array['owner','admin','expert']))));
create policy generated_documents_select on public.generated_documents for select to authenticated
using (private.is_org_member(organization_id));
create policy generated_documents_insert on public.generated_documents for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin','expert','analyst']) and generated_by = (select auth.uid()));
create policy generated_documents_update on public.generated_documents for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','expert','analyst']))
with check (private.has_org_role(organization_id, array['owner','admin','expert','analyst']));
create policy generated_documents_delete on public.generated_documents for delete to authenticated
using (private.has_org_role(organization_id, array['owner','admin']));
create policy customs_audit_events_select on public.customs_audit_events for select to authenticated
using (organization_id is not null and private.has_org_role(organization_id, array['owner','admin','expert']));

-- Explicit admin write policies for the shared corpus.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'regulatory_sources','source_documents','ingestion_runs','ingestion_issues',
    'legal_instruments','legal_versions','legal_provisions','legal_relationships',
    'hs_nomenclatures','hs_nodes','regulatory_measures','business_rules'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_platform_admin())', table_name || '_admin_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin())', table_name || '_admin_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (private.is_platform_admin())', table_name || '_admin_delete', table_name);
  end loop;
end $$;

-- Keep updated_at reliable without trusting clients.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger regulatory_sources_set_updated_at before update on public.regulatory_sources for each row execute function private.set_updated_at();
create trigger source_documents_set_updated_at before update on public.source_documents for each row execute function private.set_updated_at();
create trigger legal_instruments_set_updated_at before update on public.legal_instruments for each row execute function private.set_updated_at();
create trigger hs_nodes_set_updated_at before update on public.hs_nodes for each row execute function private.set_updated_at();
create trigger regulatory_measures_set_updated_at before update on public.regulatory_measures for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function private.set_updated_at();
create trigger customs_cases_set_updated_at before update on public.customs_cases for each row execute function private.set_updated_at();
create trigger case_items_set_updated_at before update on public.case_items for each row execute function private.set_updated_at();

create or replace function private.enforce_source_document_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_run public.ingestion_runs;
  approved_review public.expert_reviews;
  reuse_state text;
begin
  if new.lifecycle_status <> 'published' or old.lifecycle_status = 'published' then
    return new;
  end if;

  select rs.reuse_status into reuse_state
  from public.regulatory_sources rs
  where rs.id = new.source_id;

  if reuse_state <> 'authorized' then
    raise exception 'Publication blocked: source reuse is not authorized';
  end if;

  select ir.* into latest_run
  from public.ingestion_runs ir
  where ir.source_document_id = new.id
  order by ir.created_at desc
  limit 1;

  if latest_run.id is null
     or latest_run.status <> 'completed'
     or latest_run.total_pages is null
     or latest_run.total_pages < 1
     or latest_run.processed_pages <> latest_run.total_pages
     or latest_run.failed_pages <> 0
     or latest_run.quality_score is null
     or latest_run.quality_score < 85
     or latest_run.extraction_hash is null then
    raise exception 'Publication blocked: extraction is incomplete or below quality threshold';
  end if;

  if exists (
    select 1 from public.ingestion_issues ii
    where ii.ingestion_run_id = latest_run.id
      and ii.severity = 'blocking'
      and ii.status = 'open'
  ) then
    raise exception 'Publication blocked: unresolved blocking ingestion issues';
  end if;

  select er.* into approved_review
  from public.expert_reviews er
  where er.review_type = 'source_document'
    and er.entity_id = new.id
    and er.decision = 'approved'
    and er.review_snapshot ->> 'extraction_hash' = latest_run.extraction_hash
  order by er.reviewed_at desc
  limit 1;

  if approved_review.id is null then
    raise exception 'Publication blocked: no expert approval for the current extraction revision';
  end if;

  new.published_by := approved_review.reviewed_by;
  new.published_at := coalesce(new.published_at, now());
  return new;
end;
$$;

revoke all on function private.enforce_source_document_publication() from public, anon, authenticated;
create trigger source_documents_publication_gate
before update of lifecycle_status on public.source_documents
for each row execute function private.enforce_source_document_publication();

comment on table public.regulatory_sources is 'Manual-first official source registry; RSS may be used only for notices.';
comment on table public.source_documents is 'Immutable source document revisions identified by SHA-256.';
comment on table public.legal_relationships is 'Evidence-backed legal effects such as amendment, repeal and implementation.';
comment on table public.hs_nodes is 'Versioned international/national HS hierarchy with source provenance.';
comment on table public.regulatory_measures is 'Validated context connecting HS nodes to legal obligations and measures.';
comment on table public.customs_cases is 'Tenant-isolated operational import/export/transit dossier.';
