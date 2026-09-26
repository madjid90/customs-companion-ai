create or replace function private.guard_published_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare evidence_published boolean;
begin
  if tg_table_name = 'legal_provisions' then
    select v.status = 'published' into evidence_published
    from public.legal_versions v where v.id = coalesce(old.legal_version_id, new.legal_version_id);
  elsif tg_table_name = 'hs_nodes' then
    select n.status = 'published' into evidence_published
    from public.hs_nomenclatures n where n.id = coalesce(old.nomenclature_id, new.nomenclature_id);
  elsif tg_table_name = 'source_pages' then
    select d.lifecycle_status = 'published' into evidence_published
    from public.source_documents d where d.id = coalesce(old.source_document_id, new.source_document_id);
  end if;
  if coalesce(evidence_published, false) then
    raise exception 'Published evidence is immutable; create a new source or version';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_published_legal_provisions before update or delete on public.legal_provisions
for each row execute function private.guard_published_evidence();
create trigger guard_published_hs_nodes before update or delete on public.hs_nodes
for each row execute function private.guard_published_evidence();
create trigger guard_published_source_pages before update or delete on public.source_pages
for each row execute function private.guard_published_evidence();

create or replace function private.guard_hs_nomenclature_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if new.source_document_id is null or not exists (
      select 1 from public.source_documents d
      where d.id = new.source_document_id and d.lifecycle_status = 'published'
    ) then
      raise exception 'A published nomenclature requires a published source document';
    end if;
    if not exists (select 1 from public.hs_nodes h where h.nomenclature_id = new.id) then
      raise exception 'A published nomenclature requires reviewed SH nodes';
    end if;
    if exists (select 1 from public.hs_nodes h where h.nomenclature_id = new.id and h.review_status <> 'validated') then
      raise exception 'Every SH node must be validated before nomenclature publication';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_hs_nomenclature_publication before update on public.hs_nomenclatures
for each row execute function private.guard_hs_nomenclature_publication();
