-- Automatically extracted circular metadata and cross-references are useful
-- for navigation, but stay explicitly unverified until legal review.
create table public.source_document_reference_mentions (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  referenced_document_id uuid references public.source_documents(id) on delete set null,
  referenced_reference text not null,
  relationship_hint text not null check (relationship_hint in ('mentions','modifies','repeals','replaces','applies')),
  evidence_excerpt text not null,
  extraction_confidence numeric(5,2) not null check (extraction_confidence between 0 and 100),
  validation_status text not null default 'proposed' check (validation_status in ('proposed','validated','rejected')),
  created_at timestamptz not null default now(),
  unique(source_document_id,referenced_reference)
);
create index source_document_reference_mentions_target_idx on public.source_document_reference_mentions(referenced_reference);
alter table public.source_document_reference_mentions enable row level security;
grant select on public.source_document_reference_mentions to authenticated;
create policy source_document_reference_mentions_read on public.source_document_reference_mentions
  for select to authenticated using (
    validation_status <> 'rejected'
    and exists (select 1 from public.source_documents d where d.id = source_document_id)
  );

create or replace function private.refresh_circular_context(target_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  document_row public.source_documents%rowtype;
  document_text text;
  reference_match text[];
  date_match text[];
  object_match text[];
  own_reference text;
  date_candidate text;
  object_candidate text;
  mentioned text;
  hint text;
  target_id uuid;
begin
  select * into document_row from public.source_documents where id = target_document_id;
  if not found or document_row.document_type not in ('circular','agreement') then return; end if;
  select left(string_agg(text_content,E'\n' order by page_number),12000) into document_text
  from public.source_pages where source_document_id=target_document_id and page_number<=3 and review_status<>'rejected';
  if document_text is null then return; end if;

  reference_match := regexp_match(document_text,'(?i)CIRCULAIRE[[:space:]]+(N[°º]?|NO)?[[:space:]]*([0-9]{4})[[:space:]]*/[[:space:]]*([0-9]{3})');
  if reference_match is not null then own_reference := reference_match[2] || '/' || reference_match[3]; end if;
  date_match := regexp_match(document_text,'(?i)Rabat[[:space:]]*,?[[:space:]]*le[[:space:]]+([0-9]{1,2}[[:space:]]+[[:alpha:]éûôîàèùÉÛÔÎÀÈÙ]+[[:space:]]+[0-9]{4})');
  if date_match is not null then date_candidate := date_match[1]; end if;
  object_match := regexp_match(document_text,'(?is)OBJET[[:space:]]*:?[-[:space:]]*(.{8,240})(REFER|R[ÉE]F\.|Par circulaire|Le service|$)');
  if object_match is not null then object_candidate := left(regexp_replace(object_match[1],'[[:space:]]+',' ','g'),300); end if;

  update public.source_documents set metadata=jsonb_set(metadata,'{auto_legal_context}',jsonb_build_object(
    'official_reference_candidate',own_reference,'publication_date_text_candidate',date_candidate,
    'object_candidate',object_candidate,'algorithm','circular_context_v1','verified',false),true)
  where id=target_document_id;

  delete from public.source_document_reference_mentions
  where source_document_id=target_document_id and validation_status='proposed';
  for mentioned in
    select distinct match[1] || '/' || match[2]
    from regexp_matches(document_text,'(?i)(?:circulaire|n[°º]?)[[:space:]]*(?:de base[[:space:]]*)?(?:n[°º]?[[:space:]]*)?([0-9]{4})[[:space:]]*/[[:space:]]*([0-9]{3})','g') match
  loop
    if mentioned = own_reference then continue; end if;
    hint := case
      when document_text ~* ('(abroge|abrogée|annule)[^\n]{0,100}' || replace(mentioned,'/','[[:space:]]*/[[:space:]]*')) then 'repeals'
      when document_text ~* ('(modifie|modifiée|complète|actualise)[^\n]{0,120}' || replace(mentioned,'/','[[:space:]]*/[[:space:]]*')) then 'modifies'
      when document_text ~* ('(remplace)[^\n]{0,100}' || replace(mentioned,'/','[[:space:]]*/[[:space:]]*')) then 'replaces'
      when document_text ~* ('(application|applique)[^\n]{0,100}' || replace(mentioned,'/','[[:space:]]*/[[:space:]]*')) then 'applies'
      else 'mentions' end;
    select id into target_id from public.source_documents
    where metadata #>> '{auto_legal_context,official_reference_candidate}'=mentioned
    order by created_at desc limit 1;
    insert into public.source_document_reference_mentions(source_document_id,referenced_document_id,referenced_reference,relationship_hint,evidence_excerpt,extraction_confidence)
    values(target_document_id,target_id,mentioned,hint,left(document_text,1200),case when target_id is null then 65 else 80 end)
    on conflict(source_document_id,referenced_reference) do update set
      referenced_document_id=excluded.referenced_document_id,relationship_hint=excluded.relationship_hint,
      evidence_excerpt=excluded.evidence_excerpt,extraction_confidence=excluded.extraction_confidence;
  end loop;
end;
$$;
revoke all on function private.refresh_circular_context(uuid) from public,anon,authenticated;
grant execute on function private.refresh_circular_context(uuid) to service_role;

create or replace function private.refresh_circular_context_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.page_number<=3 then perform private.refresh_circular_context(new.source_document_id); end if;
  return new;
end; $$;
revoke all on function private.refresh_circular_context_trigger() from public,anon,authenticated;
create trigger source_page_circular_context after insert or update of text_content,review_status on public.source_pages
for each row execute function private.refresh_circular_context_trigger();

do $$ declare document_id uuid; begin
  for document_id in select id from public.source_documents where document_type in ('circular','agreement') and lifecycle_status<>'rejected'
  loop perform private.refresh_circular_context(document_id); end loop;
end $$;

-- Second pass resolves links whose targets were profiled later in the loop.
update public.source_document_reference_mentions m set referenced_document_id=d.id,
  extraction_confidence=greatest(m.extraction_confidence,80)
from public.source_documents d
where m.referenced_document_id is null
  and d.metadata #>> '{auto_legal_context,official_reference_candidate}'=m.referenced_reference;
