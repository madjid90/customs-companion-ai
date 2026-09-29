-- Link canonical source_documents directly to the V1 source catalog.
-- This removes the need to create new regulatory_sources rows for V1 ingestion.

alter table public.source_documents
  add column if not exists source_catalog_id uuid references public.source_catalog(id) on delete restrict;

alter table public.source_documents
  alter column source_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'source_documents_source_identity_check'
      and conrelid = 'public.source_documents'::regclass
  ) then
    alter table public.source_documents
      add constraint source_documents_source_identity_check
      check (source_id is not null or source_catalog_id is not null);
  end if;
end $$;

create unique index if not exists source_documents_catalog_sha256_uidx
  on public.source_documents(source_catalog_id, sha256)
  where source_catalog_id is not null;

create index if not exists source_documents_catalog_status_idx
  on public.source_documents(source_catalog_id, lifecycle_status, created_at desc)
  where source_catalog_id is not null;

comment on column public.source_documents.source_catalog_id is 'V1 source catalog owner for documents ingested from the generic country-pack source registry.';
