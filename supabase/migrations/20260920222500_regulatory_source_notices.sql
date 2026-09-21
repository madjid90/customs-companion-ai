create table public.regulatory_source_notices (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_sources(id) on delete cascade,
  external_id text,
  title text not null,
  source_url text not null,
  published_at timestamptz,
  summary text,
  status text not null default 'discovered' check (status in ('discovered','accepted','dismissed','ingested')),
  discovered_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  unique(source_id, source_url)
);
create index regulatory_source_notices_queue_idx on public.regulatory_source_notices(status, published_at desc nulls last);
alter table public.regulatory_source_notices enable row level security;
grant select, insert, update, delete on public.regulatory_source_notices to authenticated;
create policy regulatory_source_notices_admin_all on public.regulatory_source_notices for all to authenticated
using (private.is_platform_admin()) with check (private.is_platform_admin());
grant all on public.regulatory_source_notices to service_role;
comment on table public.regulatory_source_notices is 'RSS and official-site update discoveries awaiting human validation before ingestion.';
