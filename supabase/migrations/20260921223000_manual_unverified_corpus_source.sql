insert into public.regulatory_sources(code,name,authority_name,jurisdiction_code,source_type,acquisition_mode,reuse_status,notes)
values('MA_MANUAL_CORPUS','Corpus local fourni par l’administrateur','Autorité à vérifier','MA','internal_reference','manual_upload','review_required','Dépôt sans attribution officielle automatique; chaque document doit être rattaché à une source validée.')
on conflict(code) do nothing;
