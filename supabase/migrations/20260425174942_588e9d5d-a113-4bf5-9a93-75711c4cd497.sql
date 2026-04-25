-- =====================================================================
-- A.1 - Enrichissement legal_chunks/legal_sources pour NENC/NESH
-- =====================================================================

-- 1. Ajouter metadata JSONB à legal_chunks
ALTER TABLE public.legal_chunks 
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Index GIN général sur metadata
CREATE INDEX IF NOT EXISTS legal_chunks_metadata_gin 
  ON public.legal_chunks USING GIN (metadata);

-- 3. Index spécifique sur hs_code (cas d'usage très fréquent)
CREATE INDEX IF NOT EXISTS legal_chunks_metadata_hs_code 
  ON public.legal_chunks ((metadata->>'hs_code_normalized'));

-- 4. Index spécifique sur chapter
CREATE INDEX IF NOT EXISTS legal_chunks_metadata_chapter 
  ON public.legal_chunks ((metadata->>'chapter'));

-- 5. Index sur doc_type pour filtrer rapidement les NENC/NESH
CREATE INDEX IF NOT EXISTS legal_chunks_metadata_doc_type 
  ON public.legal_chunks ((metadata->>'doc_type'));

-- 6. Ajouter pdf_storage_path à legal_sources pour le lien direct
ALTER TABLE public.legal_sources 
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_total_pages INTEGER;

-- 7. Créer le bucket Storage pour les PDF source (privé, 50 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit) 
VALUES ('legal-source-pdfs', 'legal-source-pdfs', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- 8. Policies RLS sur le bucket : lecture authentifié, écriture service_role
DROP POLICY IF EXISTS "Authenticated users can read legal PDFs" ON storage.objects;
CREATE POLICY "Authenticated users can read legal PDFs" 
  ON storage.objects FOR SELECT 
  TO authenticated
  USING (bucket_id = 'legal-source-pdfs');

DROP POLICY IF EXISTS "Service role can manage legal PDFs" ON storage.objects;
CREATE POLICY "Service role can manage legal PDFs"
  ON storage.objects FOR ALL 
  TO service_role
  USING (bucket_id = 'legal-source-pdfs')
  WITH CHECK (bucket_id = 'legal-source-pdfs');

-- 9. Mettre à jour search_legal_chunks_hybrid pour retourner metadata
DROP FUNCTION IF EXISTS public.search_legal_chunks_hybrid(text, text, double precision, integer);

CREATE OR REPLACE FUNCTION public.search_legal_chunks_hybrid(
  query_text text, 
  query_embedding text, 
  semantic_weight double precision DEFAULT 0.5, 
  match_count integer DEFAULT 10
)
 RETURNS TABLE(
   id bigint, 
   source_id bigint, 
   chunk_text text, 
   article_number text, 
   section_title text, 
   chunk_type text, 
   page_number integer, 
   metadata jsonb,
   combined_score double precision
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  k CONSTANT INT := 60;
  embedding_vector extensions.vector(1536);
BEGIN
  embedding_vector := query_embedding::extensions.vector;
  
  RETURN QUERY
  WITH semantic_results AS (
    SELECT 
      lc.id,
      lc.source_id,
      lc.chunk_text,
      lc.article_number,
      lc.section_title,
      lc.chunk_type,
      lc.page_number,
      lc.metadata,
      1 - (lc.embedding OPERATOR(extensions.<=>) embedding_vector) as sem_score,
      ROW_NUMBER() OVER (ORDER BY lc.embedding OPERATOR(extensions.<=>) embedding_vector) as sem_rank
    FROM public.legal_chunks lc
    WHERE lc.embedding IS NOT NULL
      AND COALESCE(lc.is_active, true) = true
    ORDER BY lc.embedding OPERATOR(extensions.<=>) embedding_vector
    LIMIT 30
  ),
  fts_results AS (
    SELECT 
      lc.id,
      lc.source_id,
      lc.chunk_text,
      lc.article_number,
      lc.section_title,
      lc.chunk_type,
      lc.page_number,
      lc.metadata,
      ts_rank_cd(
        to_tsvector('french', COALESCE(lc.chunk_text, '')), 
        plainto_tsquery('french', query_text),
        32
      ) as fts_sc,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('french', COALESCE(lc.chunk_text, '')), 
          plainto_tsquery('french', query_text),
          32
        ) DESC
      ) as fts_rank
    FROM public.legal_chunks lc
    WHERE 
      query_text IS NOT NULL 
      AND query_text != ''
      AND COALESCE(lc.is_active, true) = true
      AND to_tsvector('french', COALESCE(lc.chunk_text, '')) @@ plainto_tsquery('french', query_text)
    ORDER BY fts_sc DESC
    LIMIT 30
  )
  SELECT 
    COALESCE(s.id, f.id) as id,
    COALESCE(s.source_id, f.source_id) as source_id,
    COALESCE(s.chunk_text, f.chunk_text) as chunk_text,
    COALESCE(s.article_number, f.article_number) as article_number,
    COALESCE(s.section_title, f.section_title) as section_title,
    COALESCE(s.chunk_type, f.chunk_type) as chunk_type,
    COALESCE(s.page_number, f.page_number) as page_number,
    COALESCE(s.metadata, f.metadata, '{}'::jsonb) as metadata,
    (
      COALESCE(1.0/(k + s.sem_rank), 0) * semantic_weight + 
      COALESCE(1.0/(k + f.fts_rank), 0) * (1 - semantic_weight)
    )::FLOAT as combined_score
  FROM semantic_results s
  FULL OUTER JOIN fts_results f ON s.id = f.id
  WHERE (
    COALESCE(1.0/(k + s.sem_rank), 0) * semantic_weight + 
    COALESCE(1.0/(k + f.fts_rank), 0) * (1 - semantic_weight)
  ) > 0
  ORDER BY combined_score DESC
  LIMIT match_count;
END;
$function$;