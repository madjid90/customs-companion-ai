-- ============================================================================
-- FIX: Ajouter le schéma 'extensions' au search_path des fonctions sémantiques
-- pour résoudre l'erreur "operator does not exist: extensions.vector <=> extensions.vector"
-- ============================================================================

-- Fix search_hs_codes_semantic
CREATE OR REPLACE FUNCTION public.search_hs_codes_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  code character varying,
  description_fr text,
  description_en text,
  chapter_number integer,
  section_number integer,
  level character varying,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.id,
    h.code,
    h.description_fr,
    h.description_en,
    h.chapter_number,
    h.section_number,
    h.level,
    1 - (h.embedding <=> query_embedding::vector) AS similarity
  FROM public.hs_codes h
  WHERE h.is_active = true
    AND h.embedding IS NOT NULL
    AND 1 - (h.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY h.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;

-- Fix search_knowledge_documents_semantic
CREATE OR REPLACE FUNCTION public.search_knowledge_documents_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  summary text,
  category character varying,
  country_code character varying,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    k.id,
    k.title,
    k.content,
    k.summary,
    k.category,
    k.country_code,
    1 - (k.embedding <=> query_embedding::vector) AS similarity
  FROM public.knowledge_documents k
  WHERE k.is_active = true
    AND k.embedding IS NOT NULL
    AND 1 - (k.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY k.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;

-- Fix search_pdf_extractions_semantic
CREATE OR REPLACE FUNCTION public.search_pdf_extractions_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  pdf_id uuid,
  summary text,
  extracted_text text,
  key_points jsonb,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.pdf_id,
    p.summary,
    p.extracted_text,
    p.key_points,
    1 - (p.embedding <=> query_embedding::vector) AS similarity
  FROM public.pdf_extractions p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY p.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;

-- Fix search_veille_documents_semantic
CREATE OR REPLACE FUNCTION public.search_veille_documents_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  summary text,
  category character varying,
  country_code character varying,
  importance character varying,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.title,
    v.content,
    v.summary,
    v.category,
    v.country_code,
    v.importance,
    1 - (v.embedding <=> query_embedding::vector) AS similarity
  FROM public.veille_documents v
  WHERE v.is_verified = true
    AND v.embedding IS NOT NULL
    AND 1 - (v.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY v.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;

-- Fix search_all_semantic
CREATE OR REPLACE FUNCTION public.search_all_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 20
)
RETURNS TABLE (
  source_table text,
  source_id uuid,
  title text,
  content_preview text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  (
    SELECT 
      'hs_codes'::text AS source_table,
      h.id AS source_id,
      ('Code SH ' || h.code)::text AS title,
      LEFT(h.description_fr, 500) AS content_preview,
      1 - (h.embedding <=> query_embedding::vector) AS similarity
    FROM public.hs_codes h
    WHERE h.is_active = true
      AND h.embedding IS NOT NULL
      AND 1 - (h.embedding <=> query_embedding::vector) > match_threshold
  )
  UNION ALL
  (
    SELECT 
      'knowledge_documents'::text AS source_table,
      k.id AS source_id,
      k.title::text AS title,
      LEFT(COALESCE(k.summary, k.content), 500) AS content_preview,
      1 - (k.embedding <=> query_embedding::vector) AS similarity
    FROM public.knowledge_documents k
    WHERE k.is_active = true
      AND k.embedding IS NOT NULL
      AND 1 - (k.embedding <=> query_embedding::vector) > match_threshold
  )
  UNION ALL
  (
    SELECT 
      'pdf_extractions'::text AS source_table,
      p.id AS source_id,
      COALESCE(p.summary, 'Extraction PDF')::text AS title,
      LEFT(COALESCE(p.summary, p.extracted_text), 500) AS content_preview,
      1 - (p.embedding <=> query_embedding::vector) AS similarity
    FROM public.pdf_extractions p
    WHERE p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding::vector) > match_threshold
  )
  UNION ALL
  (
    SELECT 
      'veille_documents'::text AS source_table,
      v.id AS source_id,
      v.title::text AS title,
      LEFT(COALESCE(v.summary, v.content), 500) AS content_preview,
      1 - (v.embedding <=> query_embedding::vector) AS similarity
    FROM public.veille_documents v
    WHERE v.is_verified = true
      AND v.embedding IS NOT NULL
      AND 1 - (v.embedding <=> query_embedding::vector) > match_threshold
  )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Fix find_cached_response
CREATE OR REPLACE FUNCTION public.find_cached_response(
  query_embedding text,
  similarity_threshold DOUBLE PRECISION DEFAULT 0.94
)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  response_text TEXT,
  context_used JSONB,
  confidence_level VARCHAR(20),
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rc.id,
    rc.question_text,
    rc.response_text,
    rc.context_used,
    rc.confidence_level,
    1 - (rc.question_embedding <=> query_embedding::vector) AS similarity
  FROM public.response_cache rc
  WHERE rc.question_embedding IS NOT NULL
    AND rc.expires_at > now()
    AND 1 - (rc.question_embedding <=> query_embedding::vector) > similarity_threshold
  ORDER BY rc.question_embedding <=> query_embedding::vector
  LIMIT 1;
END;
$$;