-- Drop the OLD function signatures that accept extensions.vector (keep only text versions)
DROP FUNCTION IF EXISTS public.search_hs_codes_semantic(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_knowledge_documents_semantic(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_pdf_extractions_semantic(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_veille_documents_semantic(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_all_semantic(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.find_cached_response(extensions.vector, double precision);