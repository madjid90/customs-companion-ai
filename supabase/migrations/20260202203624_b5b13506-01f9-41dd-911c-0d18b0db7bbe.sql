-- ============================================
-- MIGRATION PART 1: Colonnes, index et fonctions simples
-- ============================================

-- 1. Ajouter les colonnes manquantes à legal_chunks
ALTER TABLE public.legal_chunks
ADD COLUMN IF NOT EXISTS article_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS section_title TEXT,
ADD COLUMN IF NOT EXISTS parent_section TEXT,
ADD COLUMN IF NOT EXISTS hierarchy_path TEXT,
ADD COLUMN IF NOT EXISTS chunk_type VARCHAR(50) DEFAULT 'article',
ADD COLUMN IF NOT EXISTS mentioned_hs_codes JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS token_count INTEGER,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Index pour les recherches
CREATE INDEX IF NOT EXISTS idx_legal_chunks_article ON public.legal_chunks(article_number);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_type ON public.legal_chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_source ON public.legal_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_hs_codes ON public.legal_chunks USING GIN (mentioned_hs_codes);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_keywords ON public.legal_chunks USING GIN (keywords);

-- Index FTS pour le texte
CREATE INDEX IF NOT EXISTS idx_legal_chunks_text_fts
ON public.legal_chunks USING GIN (to_tsvector('french', COALESCE(chunk_text, '')));

-- 3. Améliorer legal_sources
ALTER TABLE public.legal_sources
ADD COLUMN IF NOT EXISTS document_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS effective_date DATE,
ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS total_chunks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'fr';

-- 4. Fonction de recherche par article
CREATE OR REPLACE FUNCTION public.search_legal_by_article(
  p_article_pattern TEXT,
  p_source_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  source_title TEXT,
  article_number VARCHAR(50),
  section_title TEXT,
  chunk_text TEXT,
  hierarchy_path TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    lc.hierarchy_path
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

-- 5. Fonction de recherche par codes SH mentionnés
CREATE OR REPLACE FUNCTION public.search_legal_by_hs_code(
  p_hs_code TEXT
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  source_title TEXT,
  article_number VARCHAR(50),
  chunk_text TEXT,
  relevance_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    END::FLOAT as relevance_score
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

-- 6. RLS
ALTER TABLE public.legal_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Legal chunks are publicly readable" ON public.legal_chunks;
CREATE POLICY "Legal chunks are publicly readable" 
ON public.legal_chunks 
FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Service role can manage legal_chunks" ON public.legal_chunks;
CREATE POLICY "Service role can manage legal_chunks" 
ON public.legal_chunks 
FOR ALL 
USING (true)
WITH CHECK (true);

-- 7. Commentaires
COMMENT ON FUNCTION public.search_legal_by_article IS 'Recherche les chunks par numéro d article';
COMMENT ON FUNCTION public.search_legal_by_hs_code IS 'Trouve les articles légaux mentionnant un code SH';