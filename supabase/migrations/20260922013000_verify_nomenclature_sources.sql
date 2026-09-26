create or replace function private.guard_hs_nomenclature_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if new.source_document_id is null or not exists (
      select 1 from public.source_documents d
      where d.id = new.source_document_id and d.lifecycle_status = 'published'
    ) then
      raise exception 'A published nomenclature requires a published master source document';
    end if;
    if not exists (select 1 from public.hs_nodes h where h.nomenclature_id = new.id) then
      raise exception 'A published nomenclature requires reviewed SH nodes';
    end if;
    if exists (
      select 1 from public.hs_nodes h
      left join public.source_pages p on p.id = h.source_page_id
      left join public.source_documents d on d.id = p.source_document_id
      where h.nomenclature_id = new.id
        and (h.review_status <> 'validated' or p.id is null or d.lifecycle_status is distinct from 'published')
    ) then
      raise exception 'Every SH node requires validation and a published source PDF/page';
    end if;
  end if;
  return new;
end;
$$;
