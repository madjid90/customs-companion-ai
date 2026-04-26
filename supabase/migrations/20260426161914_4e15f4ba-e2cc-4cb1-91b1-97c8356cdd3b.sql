-- Index GIN sur metadata pour accélérer les filtres JSONB
CREATE INDEX IF NOT EXISTS idx_legal_chunks_metadata_gin
  ON public.legal_chunks USING GIN (metadata);

-- Index spécifique sur le chapitre (filtre le plus commun)
CREATE INDEX IF NOT EXISTS idx_legal_chunks_metadata_chapter
  ON public.legal_chunks ((metadata->>'chapter'))
  WHERE metadata IS NOT NULL;

-- Index sur le doc_type
CREATE INDEX IF NOT EXISTS idx_legal_chunks_metadata_doc_type
  ON public.legal_chunks ((metadata->>'doc_type'))
  WHERE metadata IS NOT NULL;

-- Fonction de recherche NENC/NESH par métadonnées
CREATE OR REPLACE FUNCTION public.search_legal_chunks_by_hs_metadata(
  query_embedding text,
  filter_chapter text DEFAULT NULL,
  filter_heading text DEFAULT NULL,
  filter_hs_code text DEFAULT NULL,
  filter_doc_types text[] DEFAULT ARRAY['nenc', 'nesh'],
  match_count integer DEFAULT 8
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
  embedding_vector extensions.vector(1536);
BEGIN
  embedding_vector := query_embedding::extensions.vector;

  RETURN QUERY
  SELECT
    lc.id,
    lc.source_id,
    lc.chunk_text,
    lc.article_number,
    lc.section_title,
    lc.chunk_type,
    lc.page_number,
    lc.metadata,
    (1 - (lc.embedding OPERATOR(extensions.<=>) embedding_vector))::double precision AS combined_score
  FROM public.legal_chunks lc
  WHERE lc.embedding IS NOT NULL
    AND COALESCE(lc.is_active, true) = true
    AND lc.metadata IS NOT NULL
    AND (
      filter_doc_types IS NULL
      OR (lc.metadata->>'doc_type') = ANY(filter_doc_types)
    )
    AND (
      filter_chapter IS NULL
      OR (lc.metadata->>'chapter') = filter_chapter
      OR (lc.metadata->'hs_codes_mentioned') ? filter_chapter
    )
    AND (
      filter_heading IS NULL
      OR (lc.metadata->>'heading') = filter_heading
      OR (lc.metadata->'hs_codes_mentioned') ? REPLACE(filter_heading, '.', '')
    )
    AND (
      filter_hs_code IS NULL
      OR (lc.metadata->>'hs_code_normalized') = filter_hs_code
      OR (lc.metadata->'hs_codes_mentioned') ? filter_hs_code
    )
  ORDER BY lc.embedding OPERATOR(extensions.<=>) embedding_vector
  LIMIT match_count;
END;
$function$;

COMMENT ON FUNCTION public.search_legal_chunks_by_hs_metadata IS
  'Recherche les chunks NENC/NESH par métadonnées hiérarchiques (chapitre, heading, hs_code) + score sémantique.';