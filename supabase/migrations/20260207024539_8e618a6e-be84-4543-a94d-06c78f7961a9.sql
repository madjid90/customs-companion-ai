
-- Drop and recreate with page_number included
DROP FUNCTION IF EXISTS public.search_legal_chunks_hybrid(TEXT, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS public.search_legal_chunks_multilingual(TEXT, TEXT, TEXT, INT);

-- Recreate search_legal_chunks_hybrid with page_number
CREATE FUNCTION public.search_legal_chunks_hybrid(
  query_text TEXT,
  query_embedding TEXT,
  semantic_weight FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  chunk_text TEXT,
  article_number TEXT,
  section_title TEXT,
  chunk_type TEXT,
  page_number INT,
  combined_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      1 - (lc.embedding OPERATOR(extensions.<=>) embedding_vector) as sem_score,
      ROW_NUMBER() OVER (ORDER BY lc.embedding OPERATOR(extensions.<=>) embedding_vector) as sem_rank
    FROM public.legal_chunks lc
    WHERE lc.embedding IS NOT NULL
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
$$;

-- Recreate search_legal_chunks_multilingual with page_number
CREATE FUNCTION public.search_legal_chunks_multilingual(
  query_text TEXT,
  query_embedding TEXT,
  lang_config TEXT DEFAULT 'french',
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  chunk_text TEXT,
  article_number TEXT,
  section_title TEXT,
  chunk_type TEXT,
  page_number INT,
  relevance_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  tsquery_val tsquery;
BEGIN
  BEGIN
    IF lang_config = 'arabic' OR lang_config = 'simple' THEN
      tsquery_val := plainto_tsquery('simple', query_text);
    ELSE
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
    lc.page_number,
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
