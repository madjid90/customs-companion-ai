-- ============================================================================
-- ACTIVATION DE LA RECHERCHE SÉMANTIQUE VECTORIELLE
-- ============================================================================

-- 1. Activer l'extension pgvector
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Ajouter les colonnes embedding aux tables principales
ALTER TABLE public.hs_codes 
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at timestamp with time zone;

ALTER TABLE public.knowledge_documents 
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at timestamp with time zone;

ALTER TABLE public.pdf_extractions 
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at timestamp with time zone;

ALTER TABLE public.veille_documents 
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at timestamp with time zone;

-- 3. Créer les index pour la recherche vectorielle (IVFFlat pour performance)
CREATE INDEX IF NOT EXISTS idx_hs_codes_embedding ON public.hs_codes 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_embedding ON public.knowledge_documents 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_pdf_extractions_embedding ON public.pdf_extractions 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_veille_documents_embedding ON public.veille_documents 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. Fonction RPC: Recherche sémantique dans hs_codes
CREATE OR REPLACE FUNCTION public.search_hs_codes_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  code varchar,
  description_fr text,
  description_en text,
  chapter_number integer,
  section_number integer,
  level varchar,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    1 - (h.embedding <=> query_embedding) AS similarity
  FROM public.hs_codes h
  WHERE h.is_active = true
    AND h.embedding IS NOT NULL
    AND 1 - (h.embedding <=> query_embedding) > match_threshold
  ORDER BY h.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 5. Fonction RPC: Recherche sémantique dans knowledge_documents
CREATE OR REPLACE FUNCTION public.search_knowledge_documents_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  summary text,
  category varchar,
  country_code varchar,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_documents k
  WHERE k.is_active = true
    AND k.embedding IS NOT NULL
    AND 1 - (k.embedding <=> query_embedding) > match_threshold
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 6. Fonction RPC: Recherche sémantique dans pdf_extractions
CREATE OR REPLACE FUNCTION public.search_pdf_extractions_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  pdf_id uuid,
  summary text,
  extracted_text text,
  key_points jsonb,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.pdf_id,
    p.summary,
    p.extracted_text,
    p.key_points,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM public.pdf_extractions p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 7. Fonction RPC: Recherche sémantique dans veille_documents
CREATE OR REPLACE FUNCTION public.search_veille_documents_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  summary text,
  category varchar,
  country_code varchar,
  importance varchar,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    1 - (v.embedding <=> query_embedding) AS similarity
  FROM public.veille_documents v
  WHERE v.is_verified = true
    AND v.embedding IS NOT NULL
    AND 1 - (v.embedding <=> query_embedding) > match_threshold
  ORDER BY v.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 8. Fonction RPC combinée: Recherche multi-tables
CREATE OR REPLACE FUNCTION public.search_all_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  source_table text,
  source_id uuid,
  title text,
  content_preview text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  (
    -- HS Codes
    SELECT 
      'hs_codes'::text AS source_table,
      h.id AS source_id,
      ('Code SH ' || h.code)::text AS title,
      LEFT(h.description_fr, 500) AS content_preview,
      1 - (h.embedding <=> query_embedding) AS similarity
    FROM public.hs_codes h
    WHERE h.is_active = true
      AND h.embedding IS NOT NULL
      AND 1 - (h.embedding <=> query_embedding) > match_threshold
  )
  UNION ALL
  (
    -- Knowledge Documents
    SELECT 
      'knowledge_documents'::text AS source_table,
      k.id AS source_id,
      k.title::text AS title,
      LEFT(COALESCE(k.summary, k.content), 500) AS content_preview,
      1 - (k.embedding <=> query_embedding) AS similarity
    FROM public.knowledge_documents k
    WHERE k.is_active = true
      AND k.embedding IS NOT NULL
      AND 1 - (k.embedding <=> query_embedding) > match_threshold
  )
  UNION ALL
  (
    -- PDF Extractions
    SELECT 
      'pdf_extractions'::text AS source_table,
      p.id AS source_id,
      COALESCE(p.summary, 'Extraction PDF')::text AS title,
      LEFT(COALESCE(p.summary, p.extracted_text), 500) AS content_preview,
      1 - (p.embedding <=> query_embedding) AS similarity
    FROM public.pdf_extractions p
    WHERE p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding) > match_threshold
  )
  UNION ALL
  (
    -- Veille Documents
    SELECT 
      'veille_documents'::text AS source_table,
      v.id AS source_id,
      v.title::text AS title,
      LEFT(COALESCE(v.summary, v.content), 500) AS content_preview,
      1 - (v.embedding <=> query_embedding) AS similarity
    FROM public.veille_documents v
    WHERE v.is_verified = true
      AND v.embedding IS NOT NULL
      AND 1 - (v.embedding <=> query_embedding) > match_threshold
  )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- 9. Accorder les permissions aux fonctions RPC
GRANT EXECUTE ON FUNCTION public.search_hs_codes_semantic TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_knowledge_documents_semantic TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_pdf_extractions_semantic TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_veille_documents_semantic TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_all_semantic TO anon, authenticated, service_role;