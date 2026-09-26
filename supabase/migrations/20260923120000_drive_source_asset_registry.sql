-- Track every observed source file separately from its deduplicated legal content.
-- A Drive copy, a manual upload and an official-web download can therefore point
-- to the same immutable source_document without being extracted more than once.

create table public.source_assets (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_drive','local_filesystem','official_web','manual_upload')),
  external_id text not null,
  source_document_id uuid references public.source_documents(id) on delete set null,
  root_external_id text,
  relative_path text not null,
  filename text not null,
  mime_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  provider_created_at timestamptz,
  provider_modified_at timestamptz,
  provider_revision text,
  source_url text,
  detected_document_type text,
  discovery_status text not null default 'discovered'
    check (discovery_status in ('discovered','matched','queued','processing','ingested','unchanged','superseded','failed','ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (provider, external_id)
);

create index source_assets_content_idx on public.source_assets(content_sha256) where content_sha256 is not null;
create index source_assets_document_idx on public.source_assets(source_document_id) where source_document_id is not null;
create index source_assets_status_idx on public.source_assets(discovery_status, last_seen_at);
create index source_assets_path_idx on public.source_assets(provider, relative_path);

alter table public.source_assets enable row level security;
revoke all on table public.source_assets from public, anon, authenticated;
grant select, insert, update, delete on table public.source_assets to service_role;

comment on table public.source_assets is
  'Provider file occurrences and revisions. Multiple assets may resolve to one immutable source_document by SHA-256.';

create or replace function private.match_source_asset_document()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.content_sha256 is not null then
    select d.id into new.source_document_id
    from public.source_documents d
    where d.sha256 = new.content_sha256
    order by d.created_at
    limit 1;
    if new.source_document_id is not null and new.discovery_status in ('discovered','queued') then
      new.discovery_status := 'matched';
    end if;
  end if;
  new.last_seen_at := now();
  return new;
end;
$$;

create trigger source_assets_match_document
before insert or update of content_sha256 on public.source_assets
for each row execute function private.match_source_asset_document();

-- Register each path from the original corpus manifest, including duplicate
-- copies. This is service-only because it exposes private storage provenance.
create or replace function public.register_source_asset(
  input_provider text,
  input_external_id text,
  input_relative_path text,
  input_filename text,
  input_mime_type text,
  input_byte_size bigint,
  input_sha256 text,
  input_root_external_id text default null,
  input_source_url text default null,
  input_provider_modified_at timestamptz default null,
  input_detected_document_type text default null,
  input_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare asset_id uuid;
begin
  insert into public.source_assets(
    provider, external_id, root_external_id, relative_path, filename, mime_type,
    byte_size, content_sha256, source_url, provider_modified_at,
    detected_document_type, discovery_status, metadata
  ) values (
    input_provider, input_external_id, input_root_external_id, input_relative_path,
    input_filename, input_mime_type, input_byte_size, input_sha256, input_source_url,
    input_provider_modified_at, input_detected_document_type, 'discovered',
    coalesce(input_metadata, '{}'::jsonb)
  )
  on conflict (provider, external_id) do update set
    root_external_id = excluded.root_external_id,
    relative_path = excluded.relative_path,
    filename = excluded.filename,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    content_sha256 = excluded.content_sha256,
    source_url = excluded.source_url,
    provider_modified_at = excluded.provider_modified_at,
    detected_document_type = excluded.detected_document_type,
    metadata = public.source_assets.metadata || excluded.metadata,
    discovery_status = case
      when public.source_assets.content_sha256 = excluded.content_sha256 then 'unchanged'
      else 'discovered'
    end,
    last_seen_at = now()
  returning id into asset_id;
  return asset_id;
end;
$$;

revoke all on function public.register_source_asset(text,text,text,text,text,bigint,text,text,text,timestamptz,text,jsonb) from public, anon, authenticated;
grant execute on function public.register_source_asset(text,text,text,text,text,bigint,text,text,text,timestamptz,text,jsonb) to service_role;

