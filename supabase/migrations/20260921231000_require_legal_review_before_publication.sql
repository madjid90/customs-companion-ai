create or replace function private.guard_source_document_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_status='published' and old.lifecycle_status is distinct from 'published' then
    if new.published_by is null or new.published_at is null then
      raise exception 'Publication requires reviewer and timestamp';
    end if;
    if not exists (
      select 1 from public.ingestion_runs r
      where r.source_document_id=new.id and r.status in ('quality_review','completed')
    ) then
      raise exception 'Publication requires a completed extraction review';
    end if;
    if exists (
      select 1 from public.ingestion_issues i
      join public.ingestion_runs r on r.id=i.ingestion_run_id
      where r.source_document_id=new.id and i.severity='blocking' and i.status='open'
    ) then
      raise exception 'Resolve blocking ingestion issues before publication';
    end if;
    if exists (
      select 1 from public.source_pages p
      where p.source_document_id=new.id and p.review_status in ('needs_review','rejected')
    ) then
      raise exception 'Review flagged source pages before publication';
    end if;
    if new.document_type in ('customs_code','law','decree','order','circular','instruction','agreement','origin_rule','procedure','authorization','technical_control','tax_rule')
      and old.lifecycle_status <> 'legal_review' then
      raise exception 'Legal documents require legal review before publication';
    end if;
  end if;
  return new;
end;
$$;
