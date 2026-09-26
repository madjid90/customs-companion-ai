create or replace function private.link_hs_candidates_to_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.hs_extraction_candidates c
  set source_document_id = new.id
  where c.source_sha256 = new.sha256 and c.source_document_id is null;
  return new;
end;
$$;
create trigger link_hs_candidates_to_source after insert on public.source_documents
for each row execute function private.link_hs_candidates_to_source();

create or replace function private.link_hs_candidates_to_page()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.hs_extraction_candidates c
  set source_page_id = new.id
  where c.source_document_id = new.source_document_id
    and c.page_number = new.page_number and c.source_page_id is null;
  return new;
end;
$$;
create trigger link_hs_candidates_to_page after insert on public.source_pages
for each row execute function private.link_hs_candidates_to_page();

update public.hs_extraction_candidates c
set source_document_id = d.id
from public.source_documents d
where c.source_sha256 = d.sha256 and c.source_document_id is null;

update public.hs_extraction_candidates c
set source_page_id = p.id
from public.source_pages p
where c.source_document_id = p.source_document_id
  and c.page_number = p.page_number and c.source_page_id is null;
