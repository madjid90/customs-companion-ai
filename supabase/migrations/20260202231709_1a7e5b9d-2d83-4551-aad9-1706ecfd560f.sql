-- =============================================================================
-- ADD ARABIC LANGUAGE SUPPORT TO FTS SEARCH FUNCTIONS
-- =============================================================================

-- Create a function for multilingual FTS search on legal_chunks
-- This uses 'simple' configuration which works for any language including Arabic
CREATE OR REPLACE FUNCTION public.search_legal_chunks_multilingual(
  query_text text,
  lang_config text DEFAULT 'simple',
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id bigint,
  source_id bigint,
  chunk_text text,
  article_number varchar,
  section_title text,
  chunk_type varchar,
  relevance_score float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  tsquery_val tsquery;
BEGIN
  -- Use the specified language config (simple for Arabic, french for French)
  BEGIN
    IF lang_config = 'arabic' OR lang_config = 'simple' THEN
      -- For Arabic, use simple tokenizer
      tsquery_val := plainto_tsquery('simple', query_text);
    ELSE
      -- For French/other, try websearch first
      tsquery_val := websearch_to_tsquery(lang_config, query_text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    tsquery_val := plainto_tsquery('simple', query_text);
  END;

  RETURN QUERY
  SELECT 
    lc.id,
    lc.source_id,
    lc.chunk_text,
    lc.article_number,
    lc.section_title,
    lc.chunk_type,
    ts_rank_cd(
      to_tsvector('simple', COALESCE(lc.chunk_text, '')), 
      tsquery_val,
      32
    )::float AS relevance_score
  FROM public.legal_chunks lc
  WHERE 
    COALESCE(lc.is_active, true) = true
    AND to_tsvector('simple', COALESCE(lc.chunk_text, '')) @@ tsquery_val
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

-- Add language column to legal_sources if not exists (for tracking document language)
DO $$
BEGIN
  -- Check if column exists (it should from earlier schema)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'legal_sources' 
    AND column_name = 'language'
  ) THEN
    ALTER TABLE public.legal_sources ADD COLUMN language varchar(10) DEFAULT 'fr';
  END IF;
END $$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.search_legal_chunks_multilingual TO anon, authenticated, service_role;