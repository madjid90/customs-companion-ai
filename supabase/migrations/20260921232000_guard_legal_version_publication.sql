create or replace function private.guard_legal_version_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status='published' and old.status is distinct from 'published' then
    if new.approved_by is null or new.approved_at is null then
      raise exception 'Legal version requires approver and timestamp';
    end if;
    if not exists (select 1 from public.source_documents d where d.id=new.source_document_id and d.lifecycle_status='published') then
      raise exception 'Source document must be published first';
    end if;
    if not exists (select 1 from public.legal_provisions p where p.legal_version_id=new.id) then
      raise exception 'Legal version requires reviewed provisions';
    end if;
    if exists (select 1 from public.legal_provisions p where p.legal_version_id=new.id and p.review_status <> 'validated') then
      raise exception 'All legal provisions must be validated';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_legal_version_publication
before update on public.legal_versions
for each row execute function private.guard_legal_version_publication();
