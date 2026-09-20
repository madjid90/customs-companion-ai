-- Remove anonymous access to privileged legacy RPCs. Edge Functions use the
-- service role; signed-in clients retain only the read/search RPCs used by the
-- application. New privileged functions belong in the private schema.

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end $$;

do $$
declare
  fn record;
  client_rpc_names constant text[] := array[
    'find_cached_response',
    'generate_consultation_ref',
    'get_circulars_missing_chunks',
    'get_legal_source_stats',
    'get_tariff_details',
    'increment_cache_hit',
    'search_anrt_dispensed_equipment',
    'search_anrt_equipment',
    'search_hs_codes',
    'search_hs_codes_hybrid',
    'search_hs_codes_semantic',
    'search_knowledge_documents_semantic',
    'search_legal_chunks_by_hs_metadata',
    'search_legal_chunks_hybrid',
    'search_legal_chunks_multilingual',
    'search_legal_chunks_semantic',
    'search_legal_references_fts',
    'search_pdf_by_chapter_prefixes',
    'search_pdf_extractions_keyword',
    'search_pdf_extractions_semantic',
    'search_synonyms',
    'search_tariff_notes_fts',
    'search_tariff_notes_hybrid',
    'search_tariff_notes_semantic'
  ];
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(client_rpc_names)
  loop
    execute format(
      'grant execute on function %I.%I(%s) to authenticated',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end $$;

-- Lock deterministic search paths on the three functions reported by the
-- Supabase security advisor.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('search_knowledge_semantic','search_pdfs_semantic','search_veille_semantic')
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, extensions',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end $$;

-- Keep extensions outside the exposed public schema.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- Remove exact duplicate indexes reported by the performance advisor.
drop index if exists public.idx_anrt_approval;
drop index if exists public.idx_hs_code_clean;
drop index if exists public.idx_hs_codes_description_fr;
drop index if exists public.idx_legal_chunks_source;
drop index if exists public.idx_legal_chunks_metadata_gin;
drop index if exists public.idx_tariff_notes_text_fts;
