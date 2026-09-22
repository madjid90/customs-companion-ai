-- An automatically generated navigation profile is evidence, not a legal
-- classification. It never promotes a document or changes its formal type.
create or replace function private.refresh_source_document_profile(document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  document_row public.source_documents%rowtype;
  first_page text;
  inferred_heading text;
  inferred_family text;
  inferred_role text;
  inferred_confidence integer;
begin
  select * into document_row from public.source_documents where id = document_id;
  if not found then return; end if;
  select text_content into first_page from public.source_pages
    where source_document_id = document_id and page_number = 1 and review_status <> 'rejected';
  if first_page is null then return; end if;

  inferred_heading := substring(first_page from '(?im)^[[:space:]]*((SECTION|ANNEXE|CHAPITRE|CIRCULAIRE|ACCORD|DAHIR|D[ÉE]CRET|ARR[ÊE]T[ÉE]|ARTICLE)[^\r\n]{0,180})');
  if inferred_heading is null then
    inferred_heading := left(split_part(regexp_replace(first_page, '^[[:space:][:digit:]]+', ''), E'\n', 1), 180);
  end if;
  inferred_heading := nullif(btrim(regexp_replace(coalesce(inferred_heading, ''), '[[:space:]]+', ' ', 'g')), '');

  inferred_family := case
    when document_row.title like 'rdii_%' then 'rdii_compendium'
    when document_row.document_type = 'circular' then 'circulars'
    when document_row.document_type = 'agreement' then 'trade_agreements'
    when document_row.document_type = 'tariff' then 'tariff_nomenclature'
    else 'other' end;
  inferred_role := case
    when first_page ~* '^[[:space:][:digit:]]*ANNEXE' then 'annex'
    when first_page ~* '^[[:space:][:digit:]]*SECTION' then 'section'
    when first_page ~* 'CIRCULAIRE[[:space:]]+(N|N°|Nº)' then 'circular'
    when document_row.document_type = 'agreement' then 'agreement'
    when document_row.document_type = 'tariff' then 'tariff'
    else 'unclassified' end;
  inferred_confidence := case
    when inferred_role <> 'unclassified' then 75
    when inferred_family <> 'other' then 55
    else 25 end;

  update public.source_documents
  set metadata = jsonb_set(metadata, '{auto_profile}', jsonb_build_object(
    'family', inferred_family, 'role', inferred_role, 'heading', inferred_heading,
    'confidence', inferred_confidence, 'algorithm', 'first_page_rules_v1',
    'verified', false), true)
  where id = document_id;
end;
$$;

revoke all on function private.refresh_source_document_profile(uuid) from public, anon, authenticated;
grant execute on function private.refresh_source_document_profile(uuid) to service_role;

create or replace function private.refresh_source_document_profile_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.page_number = 1 then
    perform private.refresh_source_document_profile(new.source_document_id);
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_source_document_profile_trigger() from public, anon, authenticated;

create trigger source_page_auto_profile
after insert or update of text_content,review_status on public.source_pages
for each row execute function private.refresh_source_document_profile_trigger();

do $$ declare document_id uuid; begin
  for document_id in select id from public.source_documents
    where metadata->'auto_profile' is null and lifecycle_status <> 'rejected'
  loop
    perform private.refresh_source_document_profile(document_id);
  end loop;
end $$;
