-- Private storage for official corpus drafts and company dossiers.
insert into storage.buckets (id, name, public)
values
  ('legal-source-pdfs', 'legal-source-pdfs', false),
  ('case-documents', 'case-documents', false)
on conflict (id) do update set public = excluded.public;

alter table public.source_documents
  alter column storage_bucket set default 'legal-source-pdfs';

create or replace function private.storage_organization_id(object_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  first_folder text;
begin
  first_folder := (storage.foldername(object_name))[1];
  if first_folder is null or first_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return first_folder::uuid;
end;
$$;

revoke all on function private.storage_organization_id(text) from public, anon;
grant execute on function private.storage_organization_id(text) to authenticated, service_role;

drop policy if exists "Customs members read case documents" on storage.objects;
create policy "Customs members read case documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'case-documents'
  and private.is_org_member(private.storage_organization_id(name))
);

drop policy if exists "Customs editors upload case documents" on storage.objects;
create policy "Customs editors upload case documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'case-documents'
  and private.has_org_role(
    private.storage_organization_id(name),
    array['owner','admin','expert','analyst']
  )
);

drop policy if exists "Customs editors update case documents" on storage.objects;
create policy "Customs editors update case documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'case-documents'
  and private.has_org_role(
    private.storage_organization_id(name),
    array['owner','admin','expert','analyst']
  )
)
with check (
  bucket_id = 'case-documents'
  and private.has_org_role(
    private.storage_organization_id(name),
    array['owner','admin','expert','analyst']
  )
);

drop policy if exists "Customs admins delete case documents" on storage.objects;
create policy "Customs admins delete case documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'case-documents'
  and private.has_org_role(
    private.storage_organization_id(name),
    array['owner','admin']
  )
);

drop policy if exists "Platform admins read legal source files" on storage.objects;
create policy "Platform admins read legal source files"
on storage.objects for select to authenticated
using (bucket_id = 'legal-source-pdfs' and private.is_platform_admin());

drop policy if exists "Platform admins upload legal source files" on storage.objects;
create policy "Platform admins upload legal source files"
on storage.objects for insert to authenticated
with check (bucket_id = 'legal-source-pdfs' and private.is_platform_admin());

drop policy if exists "Platform admins update legal source files" on storage.objects;
create policy "Platform admins update legal source files"
on storage.objects for update to authenticated
using (bucket_id = 'legal-source-pdfs' and private.is_platform_admin())
with check (bucket_id = 'legal-source-pdfs' and private.is_platform_admin());

drop policy if exists "Platform admins delete legal source files" on storage.objects;
create policy "Platform admins delete legal source files"
on storage.objects for delete to authenticated
using (bucket_id = 'legal-source-pdfs' and private.is_platform_admin());

-- Initial manual source registry. Each source remains review_required until its
-- reuse conditions and first deposited document have been reviewed.
insert into public.regulatory_sources
  (code, name, authority_name, jurisdiction_code, source_type, acquisition_mode, base_url, rss_url, reuse_status, notes)
values
  ('MA_ADII', 'Administration des Douanes et Impôts Indirects', 'ADII', 'MA', 'official_website', 'manual_upload', 'https://www.douane.gov.ma', null, 'review_required', 'Code, RDII, circulaires et tarif déposés manuellement.'),
  ('MA_ADIL_RSS', 'Avis de changement ADIL', 'ADII', 'MA', 'official_website', 'rss_notice', 'https://www.douane.gov.ma', 'https://www.douane.gov.ma/adil/rss.xml', 'review_required', 'RSS utilisé uniquement comme avis si le flux est disponible.'),
  ('MA_SGG_BO', 'Bulletin officiel du Maroc', 'Secrétariat Général du Gouvernement', 'MA', 'official_gazette', 'manual_upload', 'https://www.sgg.gov.ma/imprimerieofficielle.aspx', null, 'review_required', 'Lois, décrets et arrêtés déposés manuellement.'),
  ('MA_MCINET', 'Commerce extérieur et contrôle industriel', 'Ministère de l’Industrie et du Commerce', 'MA', 'official_website', 'manual_upload', 'https://www.mcinet.gov.ma', null, 'review_required', 'Contrôles, licences, normes et accords.'),
  ('MA_ONSSA', 'Sécurité sanitaire des produits', 'ONSSA', 'MA', 'official_website', 'manual_upload', 'https://www.onssa.gov.ma', null, 'review_required', 'Contrôles sanitaires, vétérinaires et phytosanitaires.'),
  ('MA_ANRT', 'Équipements et homologations télécoms', 'ANRT', 'MA', 'official_website', 'manual_upload', 'https://www.anrt.ma', null, 'review_required', 'Homologations et dispenses ANRT.'),
  ('MA_CHANGE', 'Réglementation des changes', 'Office des Changes', 'MA', 'official_website', 'manual_upload', 'https://www.oc.gov.ma', null, 'review_required', 'Règles de change relatives aux opérations commerciales.'),
  ('WCO_LICENSED', 'Nomenclature et outils OMD', 'Organisation Mondiale des Douanes', 'INT', 'licensed_corpus', 'licensed_import', 'https://www.wcoomd.org', null, 'restricted', 'Import uniquement après vérification de la licence et des droits de réutilisation.')
on conflict (code) do update set
  name = excluded.name,
  authority_name = excluded.authority_name,
  acquisition_mode = excluded.acquisition_mode,
  base_url = excluded.base_url,
  rss_url = excluded.rss_url,
  notes = excluded.notes,
  updated_at = now();
