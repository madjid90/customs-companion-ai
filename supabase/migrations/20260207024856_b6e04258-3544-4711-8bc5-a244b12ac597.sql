
-- 1. Drop the OLD search_legal_chunks_multilingual (3-param version, missing page_number)
DROP FUNCTION IF EXISTS public.search_legal_chunks_multilingual(text, text, integer);

-- 2. Drop and recreate search_legal_by_article with page_number and chunk_type
DROP FUNCTION IF EXISTS public.search_legal_by_article(text, text);

CREATE FUNCTION public.search_legal_by_article(
  p_article_pattern TEXT,
  p_source_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  source_title TEXT,
  article_number VARCHAR,
  section_title TEXT,
  chunk_text TEXT,
  hierarchy_path TEXT,
  page_number INT,
  chunk_type VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lc.id,
    lc.source_id,
    ls.title as source_title,
    lc.article_number,
    lc.section_title,
    lc.chunk_text,
    lc.hierarchy_path,
    lc.page_number,
    lc.chunk_type
  FROM public.legal_chunks lc
  JOIN public.legal_sources ls ON ls.id = lc.source_id
  WHERE 
    COALESCE(lc.is_active, true) = true
    AND (
      lc.article_number ILIKE '%' || p_article_pattern || '%'
      OR lc.chunk_text ILIKE '%Article ' || p_article_pattern || '%'
    )
    AND (p_source_type IS NULL OR ls.source_type = p_source_type)
  ORDER BY 
    CASE WHEN lc.article_number = p_article_pattern THEN 0 ELSE 1 END,
    lc.article_number
  LIMIT 20;
END;
$$;

-- 3. Drop and recreate search_legal_by_hs_code with page_number
DROP FUNCTION IF EXISTS public.search_legal_by_hs_code(text);

CREATE FUNCTION public.search_legal_by_hs_code(
  p_hs_code TEXT
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  source_title TEXT,
  article_number VARCHAR,
  chunk_text TEXT,
  relevance_score FLOAT,
  page_number INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_clean TEXT;
  v_chapter TEXT;
BEGIN
  v_code_clean := REPLACE(p_hs_code, '.', '');
  v_chapter := LEFT(v_code_clean, 2);
  
  RETURN QUERY
  SELECT 
    lc.id,
    lc.source_id,
    ls.title as source_title,
    lc.article_number,
    lc.chunk_text,
    CASE 
      WHEN lc.mentioned_hs_codes ? p_hs_code THEN 1.0
      WHEN lc.mentioned_hs_codes ? v_code_clean THEN 1.0
      WHEN lc.mentioned_hs_codes ? LEFT(v_code_clean, 6) THEN 0.8
      WHEN lc.mentioned_hs_codes ? v_chapter THEN 0.5
      WHEN lc.chunk_text ILIKE '%' || p_hs_code || '%' THEN 0.6
      ELSE 0.3
    END::FLOAT as relevance_score,
    lc.page_number
  FROM public.legal_chunks lc
  JOIN public.legal_sources ls ON ls.id = lc.source_id
  WHERE 
    COALESCE(lc.is_active, true) = true
    AND (
      lc.mentioned_hs_codes ? p_hs_code
      OR lc.mentioned_hs_codes ? v_code_clean
      OR lc.mentioned_hs_codes ? LEFT(v_code_clean, 6)
      OR lc.mentioned_hs_codes ? v_chapter
      OR lc.chunk_text ILIKE '%' || p_hs_code || '%'
      OR lc.chunk_text ILIKE '%chapitre ' || v_chapter || '%'
    )
  ORDER BY relevance_score DESC
  LIMIT 20;
END;
$$;
