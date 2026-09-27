-- V1 generic brain foundation: jurisdiction packs, authority catalog,
-- source catalog and connector configurations.
-- This is additive and does not replace the existing regulatory_sources table.

create table if not exists public.jurisdiction_packs (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_code text not null unique check (jurisdiction_code ~ '^[A-Z]{2}$'),
  pack_code text not null unique check (pack_code ~ '^[A-Z0-9_]{2,40}$'),
  display_name text not null,
  scope text not null default 'national' check (scope in ('international','regional','national','private')),
  parent_pack_id uuid references public.jurisdiction_packs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','active','deprecated','archived')),
  version_label text not null default 'v0',
  coverage_notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.authority_catalog (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_pack_id uuid not null references public.jurisdiction_packs(id) on delete cascade,
  authority_code text not null check (authority_code ~ '^[A-Z0-9_]{2,80}$'),
  name text not null,
  short_name text,
  authority_type text not null check (authority_type in (
    'customs','ministry','single_window','sanitary','standards','telecom','health',
    'foreign_exchange','agriculture','food_export','radiation_safety','environment',
    'international_organization','other'
  )),
  website_url text,
  contact_url text,
  status text not null default 'active' check (status in ('active','inactive','unknown')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jurisdiction_pack_id, authority_code)
);

create table if not exists public.source_catalog (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_pack_id uuid not null references public.jurisdiction_packs(id) on delete cascade,
  authority_id uuid references public.authority_catalog(id) on delete set null,
  source_code text not null check (source_code ~ '^[A-Z0-9_]{2,100}$'),
  name text not null,
  source_family text not null check (source_family in (
    'tariff','legal','circular','license_list','technical_control','sanitary_control',
    'health_product','telecom_approval','foreign_exchange','procedure','standard',
    'origin_agreement','international_hs','manual_corpus','other'
  )),
  official_url text,
  access_method text not null check (access_method in (
    'html','pdf_index','direct_pdf','spreadsheet','portal','rss','manual_upload','licensed_api','unknown'
  )),
  automation_status text not null default 'manual_versioned' check (automation_status in (
    'automatic','semi_automatic','manual_versioned','blocked','license_required','unknown'
  )),
  priority text not null default 'P1' check (priority in ('P0','P1','P2','P3')),
  update_frequency text not null default 'unknown' check (update_frequency in ('daily','weekly','monthly','event_driven','annual','unknown')),
  data_domains text[] not null default '{}'::text[],
  formats text[] not null default '{}'::text[],
  reuse_status text not null default 'review_required' check (reuse_status in ('authorized','review_required','restricted','license_required')),
  reliability_level text not null default 'official' check (reliability_level in ('official','official_mirror','secondary','internal')),
  ingestion_strategy text not null default 'catalog_only' check (ingestion_strategy in (
    'catalog_only','download_and_extract','crawl_and_extract','manual_deposit','licensed_import','blocked_pending_access'
  )),
  regulatory_source_id uuid references public.regulatory_sources(id) on delete set null,
  active boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jurisdiction_pack_id, source_code)
);

create table if not exists public.source_connector_configs (
  id uuid primary key default gen_random_uuid(),
  source_catalog_id uuid not null references public.source_catalog(id) on delete cascade,
  connector_code text not null check (connector_code ~ '^[a-z0-9_]{2,100}$'),
  connector_type text not null check (connector_type in (
    'manual_upload','html_crawler','pdf_link_extractor','direct_pdf_fetcher',
    'spreadsheet_importer','portal_index_monitor','rss_monitor','licensed_api','blocked'
  )),
  pipeline_component text not null,
  schedule_policy text not null default 'manual' check (schedule_policy in ('manual','daily','weekly','monthly','event_driven','disabled')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  status text not null default 'draft' check (status in ('draft','active','paused','blocked','retired')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_catalog_id, connector_code)
);

create index if not exists authority_catalog_pack_idx on public.authority_catalog(jurisdiction_pack_id, authority_type);
create index if not exists source_catalog_pack_priority_idx on public.source_catalog(jurisdiction_pack_id, priority, source_family);
create index if not exists source_catalog_authority_idx on public.source_catalog(authority_id, active);
create index if not exists source_catalog_domains_gin on public.source_catalog using gin(data_domains);
create index if not exists source_connector_configs_source_idx on public.source_connector_configs(source_catalog_id, status);

alter table public.jurisdiction_packs enable row level security;
alter table public.authority_catalog enable row level security;
alter table public.source_catalog enable row level security;
alter table public.source_connector_configs enable row level security;

grant select on public.jurisdiction_packs, public.authority_catalog, public.source_catalog, public.source_connector_configs to authenticated;
grant insert, update, delete on public.jurisdiction_packs, public.authority_catalog, public.source_catalog, public.source_connector_configs to authenticated;
grant all on public.jurisdiction_packs, public.authority_catalog, public.source_catalog, public.source_connector_configs to service_role;

drop policy if exists jurisdiction_packs_read on public.jurisdiction_packs;
create policy jurisdiction_packs_read on public.jurisdiction_packs for select to authenticated
using (status in ('active','draft') or private.is_platform_admin());

drop policy if exists jurisdiction_packs_admin_write on public.jurisdiction_packs;
create policy jurisdiction_packs_admin_write on public.jurisdiction_packs for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());

drop policy if exists authority_catalog_read on public.authority_catalog;
create policy authority_catalog_read on public.authority_catalog for select to authenticated
using (exists (
  select 1 from public.jurisdiction_packs jp
  where jp.id = jurisdiction_pack_id and (jp.status in ('active','draft') or private.is_platform_admin())
));

drop policy if exists authority_catalog_admin_write on public.authority_catalog;
create policy authority_catalog_admin_write on public.authority_catalog for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());

drop policy if exists source_catalog_read on public.source_catalog;
create policy source_catalog_read on public.source_catalog for select to authenticated
using (active or private.is_platform_admin());

drop policy if exists source_catalog_admin_write on public.source_catalog;
create policy source_catalog_admin_write on public.source_catalog for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());

drop policy if exists source_connector_configs_admin_read on public.source_connector_configs;
create policy source_connector_configs_admin_read on public.source_connector_configs for select to authenticated
using (private.is_platform_admin());

drop policy if exists source_connector_configs_admin_write on public.source_connector_configs;
create policy source_connector_configs_admin_write on public.source_connector_configs for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());

insert into public.jurisdiction_packs(jurisdiction_code, pack_code, display_name, scope, status, version_label, coverage_notes, metadata)
values ('MA', 'MA', 'Pack Maroc', 'national', 'draft', 'v1-planning', 'Pack Maroc V1 en constitution : ADII, MIC, ONSSA, PortNet, AMMPS/Santé, ANRT, Office des Changes et sources internationales SH selon droits.', jsonb_build_object('v1_scope','morocco_customs_brain'))
on conflict (jurisdiction_code) do update set
  pack_code = excluded.pack_code,
  display_name = excluded.display_name,
  scope = excluded.scope,
  status = excluded.status,
  version_label = excluded.version_label,
  coverage_notes = excluded.coverage_notes,
  metadata = public.jurisdiction_packs.metadata || excluded.metadata,
  updated_at = now();

with ma as (select id from public.jurisdiction_packs where jurisdiction_code='MA')
insert into public.authority_catalog(jurisdiction_pack_id, authority_code, name, short_name, authority_type, website_url, status, metadata)
select ma.id, v.authority_code, v.name, v.short_name, v.authority_type, v.website_url, 'active', v.metadata
from ma
cross join (values
  ('ADII','Administration des Douanes et Impôts Indirects','ADII','customs','https://www.douane.gov.ma', jsonb_build_object('priority','P0')),
  ('PORTNET','PortNet S.A.','PortNet','single_window','https://www.portnet.ma', jsonb_build_object('priority','P0')),
  ('MIC','Ministère de l’Industrie et du Commerce','MIC','ministry','https://www.mcinet.gov.ma', jsonb_build_object('priority','P0')),
  ('ONSSA','Office National de Sécurité Sanitaire des Produits Alimentaires','ONSSA','sanitary','https://www.onssa.gov.ma', jsonb_build_object('priority','P0')),
  ('AMMPS','Agence Marocaine des Médicaments et des Produits de Santé','AMMPS','health','https://www.ammps.gov.ma', jsonb_build_object('priority','P0')),
  ('SANTE','Ministère de la Santé et de la Protection Sociale','Santé','health','https://www.sante.gov.ma', jsonb_build_object('priority','P0')),
  ('ANRT','Agence Nationale de Réglementation des Télécommunications','ANRT','telecom','https://www.anrt.ma', jsonb_build_object('priority','P0')),
  ('OFFICE_CHANGES','Office des Changes','Office des Changes','foreign_exchange','https://www.oc.gov.ma', jsonb_build_object('priority','P0')),
  ('IMANOR','Institut Marocain de Normalisation','IMANOR','standards','https://www.imanor.gov.ma', jsonb_build_object('priority','P1')),
  ('MOROCCO_FOODEX','Morocco Foodex','Morocco Foodex','food_export','https://www.moroccofoodex.org.ma', jsonb_build_object('priority','P1')),
  ('AMSSNUR','Agence Marocaine de Sûreté et de Sécurité Nucléaires et Radiologiques','AMSSNuR','radiation_safety','https://amssnur.org.ma', jsonb_build_object('priority','P1')),
  ('WCO','Organisation Mondiale des Douanes','OMD/WCO','international_organization','https://www.wcoomd.org', jsonb_build_object('priority','P1','license_required',true))
) as v(authority_code, name, short_name, authority_type, website_url, metadata)
on conflict (jurisdiction_pack_id, authority_code) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  authority_type = excluded.authority_type,
  website_url = excluded.website_url,
  status = excluded.status,
  metadata = public.authority_catalog.metadata || excluded.metadata,
  updated_at = now();

with ma as (select id from public.jurisdiction_packs where jurisdiction_code='MA'),
auth as (select id, authority_code from public.authority_catalog where jurisdiction_pack_id=(select id from ma))
insert into public.source_catalog(
  jurisdiction_pack_id, authority_id, source_code, name, source_family, official_url,
  access_method, automation_status, priority, update_frequency, data_domains, formats,
  reuse_status, reliability_level, ingestion_strategy, active, notes, metadata
)
select
  ma.id,
  auth.id,
  v.source_code,
  v.name,
  v.source_family,
  v.official_url,
  v.access_method,
  v.automation_status,
  v.priority,
  v.update_frequency,
  v.data_domains,
  v.formats,
  v.reuse_status,
  'official',
  v.ingestion_strategy,
  true,
  v.notes,
  v.metadata
from ma
cross join (values
  ('ADII','ADII_TARIF','Tarif intégré ADII / ADIL','tariff','https://www.douane.gov.ma/web/guest/tarif#https://www.douane.gov.ma/tarif/tarif/init.jsf?','portal','semi_automatic','P0','event_driven',array['hs','tariff','tax','documents','standards'],array['html','pdf'],'review_required','crawl_and_extract','Accès JSF/portail complexe ; utiliser téléchargement contrôlé et validation.', jsonb_build_object('audit_ref','P0_ADII_TARIF')),
  ('ADII','ADII_LEGAL_BASES','Bases législatives et réglementaires ADII','legal','https://www.douane.gov.ma/web/guest/nos-bases-legislatives-et-reglementaires','html','semi_automatic','P0','event_driven',array['legal','circular','customs_code','procedure'],array['html','pdf'],'review_required','crawl_and_extract','Pages et documents ADII ; certaines pages peuvent rejeter les accès automatisés.', jsonb_build_object('audit_ref','P0_ADII_LEGAL')),
  ('ADII','ADII_CIRCULAR_PDFS','Circulaires et documents PDF ADII / ADIL','circular','https://www.douane.gov.ma/adil/PDF/','direct_pdf','semi_automatic','P0','event_driven',array['circular','tariff_update','tax','legal'],array['pdf'],'review_required','download_and_extract','URLs PDF directes connues ; découverte complète à fiabiliser.', jsonb_build_object('examples', jsonb_build_array('5740.PDF','5693.PDF','5558.pdf'))),
  ('PORTNET','PORTNET_COMMERCE_EXTERIEUR','PortNet Commerce Extérieur','procedure','https://www.portnet.ma/portnet-commerce-exterieur','html','semi_automatic','P0','event_driven',array['procedure','authorization','single_window','case_status'],array['html','pdf'],'review_required','crawl_and_extract','Modéliser procédures et statuts ; ne pas automatiser les transactions protégées sans accès/API.', jsonb_build_object('transactional_access','protected')),
  ('MIC','MIC_DOCUMENTS_SERVICES','Documents et services MIC','technical_control','https://mcinet.gov.ma/fr/content/documents-et-services-en-ligne','html','semi_automatic','P0','event_driven',array['license','technical_control','standards','inspection'],array['html','pdf','spreadsheet'],'review_required','crawl_and_extract','Source de documents MIC, listes et circulaires.', jsonb_build_object('audit_ref','P0_MIC_DOCS')),
  ('MIC','MIC_IMPORT_LICENSE_LIST','Liste marchandises soumises à licence d’importation','license_list','https://www.mcinet.gov.ma/fr/content/liste-des-marchandises-soumises-licence-dimportation-0','pdf_index','semi_automatic','P0','event_driven',array['license','restriction','hs'],array['pdf'],'review_required','download_and_extract','Extraction tableau nécessaire : codes nomenclature et restrictions.', jsonb_build_object('seed_pdf','https://mcinet.gov.ma/sites/default/files/Arretes/Arrete1308-94_218.pdf')),
  ('MIC','MIC_INDUSTRIAL_CONTROLLED_PRODUCTS','Liste produits industriels contrôlés à l’importation','technical_control','https://www.mcinet.gov.ma/sites/default/files/liste%20des%20produits%20controles%20a%20limportation%20au%20maroc.pdf','direct_pdf','semi_automatic','P0','event_driven',array['technical_control','standards','hs','conformity'],array['pdf'],'review_required','download_and_extract','PDF/tableaux bilingues ; extraction code/norme/contrôle.', jsonb_build_object('law','24-09')),
  ('ONSSA','ONSSA_IMPORT_EXPORT_CONTROL','ONSSA contrôle à l’importation et à l’exportation','sanitary_control','https://www.onssa.gov.ma/controle-a-limportation-et-a-lexportation/','html','semi_automatic','P0','event_driven',array['sanitary','phytosanitary','food','animal','vegetal','certificate'],array['html','pdf'],'review_required','crawl_and_extract','Procédures et modèles certificats par famille produit.', jsonb_build_object('audit_ref','P0_ONSSA')),
  ('ONSSA','ONSSA_ANIMAL_IMPORT_PROCEDURE','ONSSA procédures import produits animaux','sanitary_control','https://www.onssa.gov.ma/controle-a-limportation-et-a-lexportation/importation-des-produits-alimentaires-2/produits-animaux/procedures-dimportation/','html','semi_automatic','P0','event_driven',array['sanitary','animal','procedure','documents'],array['html'],'review_required','crawl_and_extract','Contrôle import produits animaux.', '{}'::jsonb),
  ('ONSSA','ONSSA_VEGETAL_IMPORT_PROCEDURE','ONSSA procédures import produits végétaux','sanitary_control','https://www.onssa.gov.ma/controle-a-limportation-et-a-lexportation/importation-des-produits-alimentaires-2/produits-vegetaux/procedure-de-controle/','html','semi_automatic','P0','event_driven',array['phytosanitary','vegetal','procedure','documents'],array['html'],'review_required','crawl_and_extract','Contrôle import produits végétaux.', '{}'::jsonb),
  ('AMMPS','AMMPS_MEDICINE_IMPORT_EXPORT','AMMPS import/export médicaments usage humain','health_product','https://www.ammps.gov.ma/note-information/publication-de-la-ligne-directrice-relative-a-limportation-et-a-lexportation-des-medicaments-a-usage-humain','html','semi_automatic','P0','event_driven',array['health','medicine','authorization','documents'],array['html','pdf'],'review_required','crawl_and_extract','Ligne directrice médicaments à usage humain.', '{}'::jsonb),
  ('SANTE','SANTE_HEALTH_PRODUCT_REGULATION','Réglementation produits de santé','health_product','https://www.sante.gov.ma/Reglementation/Pages/REGLEMENTATION-APPLICABLE-AU-PRODUITS-DE-SANTE.aspx','html','semi_automatic','P0','event_driven',array['health','medical_device','medicine','legal'],array['html','pdf'],'review_required','crawl_and_extract','Textes santé et dispositifs médicaux.', '{}'::jsonb),
  ('ANRT','ANRT_EQUIPMENT_APPROVAL','ANRT agréments des équipements','telecom_approval','https://www.anrt.ma/ar/e-services/agrements-des-equipements','portal','semi_automatic','P0','event_driven',array['telecom','radio','approval','equipment'],array['html','pdf','spreadsheet'],'review_required','crawl_and_extract','Agrément équipements télécom/radio ; portail/liste à analyser.', '{}'::jsonb),
  ('ANRT','ANRT_DECISION_16_24','Décision ANRT 16/24 agrément équipements','telecom_approval','https://www.anrt.ma/sites/default/files/2025-04/Decision-Agrement-16-24-Ver-exploitable-FR.pdf','direct_pdf','semi_automatic','P0','event_driven',array['telecom','approval','legal','procedure'],array['pdf'],'review_required','download_and_extract','Procédure, validité agréments/autorisations.', '{}'::jsonb),
  ('OFFICE_CHANGES','OC_REGULATIONS','Office des Changes réglementations','foreign_exchange','https://www.oc.gov.ma/fr/reglementations?field_categorie_reglementation_target_id=40&field_thematique_value=All','html','semi_automatic','P0','event_driven',array['foreign_exchange','payment','import','export'],array['html','pdf'],'review_required','crawl_and_extract','Règlementations change import/export.', '{}'::jsonb),
  ('OFFICE_CHANGES','OC_IGOC_2026','Instruction Générale des Opérations de Change 2026','foreign_exchange','https://www.oc.gov.ma/sites/default/files/2026-01/IGOC%202026_1.pdf','direct_pdf','semi_automatic','P0','annual',array['foreign_exchange','payment','import','export'],array['pdf'],'review_required','download_and_extract','IGOC 2026.', '{}'::jsonb),
  ('WCO','WCO_HS_INTERNATIONAL','OMD/WCO Harmonized System international','international_hs','https://www.wcoomd.org/en/topics/nomenclature/instrument-and-tools/hs-nomenclature-2022-edition','html','license_required','P1','annual',array['hs','international','classification'],array['html','licensed_data'],'license_required','blocked_pending_access','Notes/outils OMD soumis à droits ; ne pas ingérer sans licence.', jsonb_build_object('license_required',true))
) as v(v_authority_code, source_code, name, source_family, official_url, access_method, automation_status, priority, update_frequency, data_domains, formats, reuse_status, ingestion_strategy, notes, metadata)
join auth on auth.authority_code = v.v_authority_code
on conflict (jurisdiction_pack_id, source_code) do update set
  authority_id = excluded.authority_id,
  name = excluded.name,
  source_family = excluded.source_family,
  official_url = excluded.official_url,
  access_method = excluded.access_method,
  automation_status = excluded.automation_status,
  priority = excluded.priority,
  update_frequency = excluded.update_frequency,
  data_domains = excluded.data_domains,
  formats = excluded.formats,
  reuse_status = excluded.reuse_status,
  reliability_level = excluded.reliability_level,
  ingestion_strategy = excluded.ingestion_strategy,
  active = excluded.active,
  notes = excluded.notes,
  metadata = public.source_catalog.metadata || excluded.metadata,
  updated_at = now();

with sources as (select id, source_code, access_method, ingestion_strategy from public.source_catalog where source_code like 'ADII_%' or source_code like 'MIC_%' or source_code like 'ONSSA_%' or source_code like 'ANRT_%' or source_code like 'AMMPS_%' or source_code like 'SANTE_%' or source_code like 'OC_%' or source_code like 'PORTNET_%' or source_code like 'WCO_%')
insert into public.source_connector_configs(source_catalog_id, connector_code, connector_type, pipeline_component, schedule_policy, config, status)
select
  id,
  lower(source_code) || '_adapter',
  case
    when ingestion_strategy = 'blocked_pending_access' then 'blocked'
    when access_method = 'direct_pdf' then 'direct_pdf_fetcher'
    when access_method = 'pdf_index' then 'pdf_link_extractor'
    when access_method = 'portal' then 'portal_index_monitor'
    when access_method = 'html' then 'html_crawler'
    when access_method = 'spreadsheet' then 'spreadsheet_importer'
    else 'manual_upload'
  end,
  case
    when source_code like '%TARIF%' then 'tariff-extractor'
    when source_code like '%LICENSE%' or source_code like '%CONTROL%' or source_code like '%ONSSA%' or source_code like '%ANRT%' or source_code like '%AMMPS%' or source_code like '%OC_%' or source_code like '%PORTNET%' then 'obligation-extractor'
    when source_code like '%LEGAL%' or source_code like '%CIRCULAR%' or source_code like '%IGOC%' then 'legal-structure-extractor'
    else 'document-ingestion-worker'
  end,
  'manual',
  jsonb_build_object('seeded_from','20260927220000_jurisdiction_source_catalog','requires_review_before_activation',true),
  case when ingestion_strategy = 'blocked_pending_access' then 'blocked' else 'draft' end
from sources
on conflict (source_catalog_id, connector_code) do update set
  connector_type = excluded.connector_type,
  pipeline_component = excluded.pipeline_component,
  schedule_policy = excluded.schedule_policy,
  config = public.source_connector_configs.config || excluded.config,
  status = excluded.status,
  updated_at = now();

create or replace function public.get_v1_source_catalog_summary()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'jurisdiction_packs', (select count(*) from public.jurisdiction_packs),
    'authorities', (select count(*) from public.authority_catalog),
    'sources', (select count(*) from public.source_catalog),
    'p0_sources', (select count(*) from public.source_catalog where priority='P0'),
    'connectors', (select count(*) from public.source_connector_configs),
    'connectors_by_status', coalesce((
      select jsonb_object_agg(status, count order by status)
      from (
        select status, count(*) as count
        from public.source_connector_configs
        group by status
      ) s
    ), '{}'::jsonb),
    'sources_by_strategy', coalesce((
      select jsonb_object_agg(ingestion_strategy, count order by ingestion_strategy)
      from (
        select ingestion_strategy, count(*) as count
        from public.source_catalog
        group by ingestion_strategy
      ) s
    ), '{}'::jsonb),
    'p0_sources_by_authority', coalesce((
      select jsonb_object_agg(authority_code, count order by authority_code)
      from (
        select a.authority_code, count(*) as count
        from public.source_catalog sc
        join public.authority_catalog a on a.id = sc.authority_id
        where sc.priority='P0'
        group by a.authority_code
      ) s
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.get_v1_source_catalog_summary() from public, anon, authenticated;
grant execute on function public.get_v1_source_catalog_summary() to authenticated, service_role;

comment on table public.jurisdiction_packs is 'Versioned country or regional packs. The common brain is generic; country-specific sources and rules live in packs.';
comment on table public.authority_catalog is 'Authorities and agencies responsible for customs, controls, licenses, standards and procedures in a jurisdiction pack.';
comment on table public.source_catalog is 'Official source registry for multi-source ingestion. Each source declares format, access method, priority, automation status and ingestion strategy.';
comment on table public.source_connector_configs is 'Per-source connector configuration for discovery and ingestion workers. Draft until reviewed and activated.';
comment on function public.get_v1_source_catalog_summary() is 'Admin/authenticated summary of V1 source catalog coverage and connector status.';
