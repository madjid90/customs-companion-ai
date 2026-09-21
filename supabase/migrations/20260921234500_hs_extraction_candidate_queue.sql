create table public.hs_extraction_candidates (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_relative_path text not null,
  source_document_id uuid references public.source_documents(id) on delete set null,
  source_page_id uuid references public.source_pages(id) on delete set null,
  page_number integer not null check (page_number > 0),
  line_number integer not null check (line_number > 0),
  code text not null check (code ~ '^[0-9]{10}$'),
  chapter_number text not null check (chapter_number ~ '^[0-9]{2}$'),
  description_fragment text not null,
  raw_line text not null,
  derivation_method text not null check (derivation_method in ('explicit_10','inherited_prefix')),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  duty_rate_candidate text,
  review_status text not null default 'proposed' check (review_status in ('proposed','validated','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique(source_sha256,page_number,line_number,code)
);
create index hs_extraction_candidates_review_idx on public.hs_extraction_candidates(review_status,chapter_number,code);
create index hs_extraction_candidates_code_idx on public.hs_extraction_candidates(code);
create index hs_extraction_candidates_document_idx on public.hs_extraction_candidates(source_document_id) where source_document_id is not null;
create index hs_extraction_candidates_page_idx on public.hs_extraction_candidates(source_page_id) where source_page_id is not null;
alter table public.hs_extraction_candidates enable row level security;
grant select,insert,update,delete on public.hs_extraction_candidates to authenticated;
create policy hs_extraction_candidates_admin_select on public.hs_extraction_candidates for select to authenticated using ((select private.is_platform_admin()));
create policy hs_extraction_candidates_admin_insert on public.hs_extraction_candidates for insert to authenticated with check ((select private.is_platform_admin()));
create policy hs_extraction_candidates_admin_update on public.hs_extraction_candidates for update to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy hs_extraction_candidates_admin_delete on public.hs_extraction_candidates for delete to authenticated using ((select private.is_platform_admin()));
