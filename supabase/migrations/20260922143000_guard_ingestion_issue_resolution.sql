create or replace function private.guard_ingestion_issue_resolution()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    if new.resolved_by is null or new.resolved_at is null or length(btrim(coalesce(new.resolution, ''))) < 10 then
      raise exception 'Issue resolution requires reviewer, timestamp, and explanation';
    end if;
    if old.issue_type in ('empty_page', 'ocr_noise', 'table_alignment')
      and not exists (
        select 1 from public.source_page_revisions revision
        where revision.ingestion_issue_id = old.id
      ) then
      raise exception 'Page extraction issues require an audited source-page correction';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_ingestion_issue_resolution before update on public.ingestion_issues
for each row execute function private.guard_ingestion_issue_resolution();

create or replace function private.guard_page_revision_issue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ingestion_issue_id is not null and not exists (
    select 1 from public.ingestion_issues i
    join public.ingestion_runs r on r.id = i.ingestion_run_id
    join public.source_pages p on p.id = new.source_page_id
    where i.id = new.ingestion_issue_id
      and i.issue_type in ('empty_page', 'ocr_noise', 'table_alignment')
      and i.status = 'open'
      and i.page_number = p.page_number
      and r.source_document_id = p.source_document_id
  ) then
    raise exception 'Correction must target an open extraction issue on this page';
  end if;
  return new;
end;
$$;
create trigger guard_page_revision_issue before insert on public.source_page_revisions
for each row execute function private.guard_page_revision_issue();
