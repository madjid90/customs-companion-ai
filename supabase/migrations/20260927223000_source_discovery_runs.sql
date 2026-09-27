-- V1 source discovery audit layer.
-- This connects discovered assets to source_catalog without replacing source_documents.

alter table public.source_assets
  add column if not exists source_catalog_id uuid references public.source_catalog(id) on delete set null,
  add column if not exists source_connector_config_id uuid references public.source_connector_configs(id) on delete set null,
  add column if not exists discovery_run_id uuid;

create index if not exists source_assets_catalog_idx on public.source_assets(source_catalog_id, discovery_status, last_seen_at)
  where source_catalog_id is not null;
create index if not exists source_assets_connector_idx on public.source_assets(source_connector_config_id, discovery_status)
  where source_connector_config_id is not null;

create table if not exists public.source_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  source_catalog_id uuid not null references public.source_catalog(id) on delete cascade,
  source_connector_config_id uuid references public.source_connector_configs(id) on delete set null,
  connector_type text not null,
  pipeline_component text not null,
  run_mode text not null default 'plan_only' check (run_mode in ('plan_only','discovery','download','snapshot','import')),
  status text not null default 'planned' check (status in ('planned','running','completed','completed_with_warnings','failed','blocked','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  discovered_count integer not null default 0 check (discovered_count >= 0),
  changed_count integer not null default 0 check (changed_count >= 0),
  queued_asset_count integer not null default 0 check (queued_asset_count >= 0),
  blocked_reason text,
  error_summary text,
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan)='object'),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.source_assets
  add constraint source_assets_discovery_run_fk foreign key (discovery_run_id)
  references public.source_discovery_runs(id) on delete set null;

create index if not exists source_discovery_runs_source_idx on public.source_discovery_runs(source_catalog_id, status, created_at desc);
create index if not exists source_discovery_runs_connector_idx on public.source_discovery_runs(source_connector_config_id, status, created_at desc)
  where source_connector_config_id is not null;

alter table public.source_discovery_runs enable row level security;
revoke all on public.source_discovery_runs from public, anon, authenticated;
grant select, insert, update, delete on public.source_discovery_runs to service_role;
grant select on public.source_discovery_runs to authenticated;

drop policy if exists source_discovery_runs_admin_read on public.source_discovery_runs;
create policy source_discovery_runs_admin_read on public.source_discovery_runs for select to authenticated
using (public.is_admin());

comment on table public.source_discovery_runs is 'Audited discovery/import runs for source_catalog connectors. Runs store plan, counts and errors before assets become documents.';
comment on column public.source_assets.source_catalog_id is 'Official source catalog entry that discovered or owns this asset occurrence.';
comment on column public.source_assets.source_connector_config_id is 'Connector configuration that discovered this asset occurrence.';
comment on column public.source_assets.discovery_run_id is 'Discovery/import run that produced or last updated this occurrence.';
