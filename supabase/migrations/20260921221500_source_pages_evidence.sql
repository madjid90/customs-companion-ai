create table public.source_pages (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  text_content text not null,
  text_sha256 text not null check (text_sha256 ~ '^[a-f0-9]{64}$'),
  extraction_method text not null check (extraction_method in ('native_pdf','ocr','vision','hybrid')),
  extraction_confidence numeric(5,2) check (extraction_confidence between 0 and 100),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','needs_review','validated','rejected')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_document_id, page_number)
);
create index source_pages_review_queue_idx on public.source_pages(review_status, source_document_id, page_number);
create index source_pages_document_idx on public.source_pages(source_document_id, page_number);
alter table public.source_pages enable row level security;
grant select, insert, update, delete on public.source_pages to authenticated;
create policy source_pages_read on public.source_pages for select to authenticated
using ((select private.is_platform_admin()) or exists (
  select 1 from public.source_documents d
  where d.id = source_document_id and d.lifecycle_status = 'published'
));
create policy source_pages_admin_insert on public.source_pages for insert to authenticated
with check ((select private.is_platform_admin()));
create policy source_pages_admin_update on public.source_pages for update to authenticated
using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy source_pages_admin_delete on public.source_pages for delete to authenticated
using ((select private.is_platform_admin()));
alter table public.legal_provisions add column source_page_id uuid references public.source_pages(id) on delete set null;
alter table public.hs_nodes add column source_page_id uuid references public.source_pages(id) on delete set null;
create index legal_provisions_source_page_idx on public.legal_provisions(source_page_id) where source_page_id is not null;
create index hs_nodes_source_page_idx on public.hs_nodes(source_page_id) where source_page_id is not null;
