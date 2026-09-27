-- Fix legal reference type detection for Moroccan legal references.
-- PostgreSQL regex \b did not behave as intended in the previous helper, so use
-- explicit lower-case pattern matching and repair draft placeholders already made.

create or replace function private.legal_reference_candidate_type(reference_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(reference_raw, '')) like '%décret%'
      or lower(coalesce(reference_raw, '')) like '%decret%'
    then 'decree'
    when lower(coalesce(reference_raw, '')) like '%arrêté%'
      or lower(coalesce(reference_raw, '')) like '%arrete%'
      or lower(coalesce(reference_raw, '')) like '%order%'
    then 'order'
    when lower(coalesce(reference_raw, '')) like '%circulaire%'
      or lower(coalesce(reference_raw, '')) like '%note%'
    then 'circular'
    when lower(coalesce(reference_raw, '')) like '%accord%'
      or lower(coalesce(reference_raw, '')) like '%convention%'
      or lower(coalesce(reference_raw, '')) like '%traité%'
      or lower(coalesce(reference_raw, '')) like '%traite%'
    then 'agreement'
    when lower(coalesce(reference_raw, '')) like '%dahir%'
      or lower(coalesce(reference_raw, '')) like '%loi%'
    then 'law'
    else 'guide'
  end
$$;

update public.legal_instruments li
set instrument_type = private.legal_reference_candidate_type(li.canonical_title),
    authority_rank = private.legal_reference_authority_rank(private.legal_reference_candidate_type(li.canonical_title)),
    updated_at = now()
where li.jurisdiction_code = 'MA'
  and li.status = 'draft'
  and li.issuing_authority = 'Autorité à vérifier'
  and li.instrument_type = 'guide'
  and private.legal_reference_candidate_type(li.canonical_title) <> 'guide'
  and not exists (
    select 1
    from public.legal_instruments existing
    where existing.id <> li.id
      and existing.jurisdiction_code = li.jurisdiction_code
      and existing.instrument_type = private.legal_reference_candidate_type(li.canonical_title)
      and existing.official_reference = li.official_reference
  );

comment on function private.legal_reference_candidate_type(text) is 'Classifies raw Moroccan legal reference labels into canonical instrument types for draft relationship promotion.';
