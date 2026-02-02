-- ============================================
-- FONCTIONS RPC HYBRIDES POUR RECHERCHE RAG
-- Contient: search_hs_codes_hybrid, search_tariff_notes_hybrid, search_legal_chunks_hybrid
-- ============================================

-- ============================================
-- 1. FUNCTION: search_hs_codes_hybrid
-- ============================================
CREATE OR REPLACE FUNCTION public.search_hs_codes_hybrid(
  query_text TEXT,
  query_embedding TEXT,
  semantic_weight FLOAT DEFAULT 0.6,
  match_count INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  code VARCHAR(20),
  code_clean VARCHAR(20),
  description_fr TEXT,
  description_en TEXT,
  chapter_number INTEGER,
  level VARCHAR(20),
  semantic_score FLOAT,
  fts_score FLOAT,
  combined_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  k CONSTANT INT := 60;
  embedding_vector extensions.vector(1536);
BEGIN
  embedding_vector := query_embedding::extensions.vector;
  
  RETURN QUERY
  WITH semantic_results AS (
    SELECT 
      hs.id,
      hs.code,
      hs.code_clean,
      hs.description_fr,
      hs.description_en,
      hs.chapter_number,
      hs.level,
      1 - (hs.embedding <=> embedding_vector) as sem_score,
      ROW_NUMBER() OVER (ORDER BY hs.embedding <=> embedding_vector) as sem_rank
    FROM public.hs_codes hs
    WHERE 
      hs.embedding IS NOT NULL
      AND hs.is_active = true
    ORDER BY hs.embedding <=> embedding_vector
    LIMIT 50
  ),
  fts_results AS (
    SELECT 
      hs.id,
      hs.code,
      hs.code_clean,
      hs.description_fr,
      hs.description_en,
      hs.chapter_number,
      hs.level,
      ts_rank_cd(
        to_tsvector('french', COALESCE(hs.description_fr, '')), 
        plainto_tsquery('french', query_text),
        32
      ) as fts_sc,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('french', COALESCE(hs.description_fr, '')), 
          plainto_tsquery('french', query_text),
          32
        ) DESC
      ) as fts_rank
    FROM public.hs_codes hs
    WHERE 
      hs.is_active = true
      AND query_text IS NOT NULL 
      AND query_text != ''
      AND to_tsvector('french', COALESCE(hs.description_fr, '')) @@ plainto_tsquery('french', query_text)
    ORDER BY fts_sc DESC
    LIMIT 50
  )
  SELECT 
    COALESCE(s.id, f.id) as id,
    COALESCE(s.code, f.code) as code,
    COALESCE(s.code_clean, f.code_clean) as code_clean,
    COALESCE(s.description_fr, f.description_fr) as description_fr,
    COALESCE(s.description_en, f.description_en) as description_en,
    COALESCE(s.chapter_number, f.chapter_number) as chapter_number,
    COALESCE(s.level, f.level) as level,
    COALESCE(s.sem_score, 0)::FLOAT as semantic_score,
    COALESCE(f.fts_sc, 0)::FLOAT as fts_score,
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

-- ============================================
-- 2. FUNCTION: search_tariff_notes_hybrid
-- ============================================
CREATE OR REPLACE FUNCTION public.search_tariff_notes_hybrid(
  query_text TEXT,
  query_embedding TEXT,
  chapter_filters TEXT[] DEFAULT NULL,
  semantic_weight FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 15
)
RETURNS TABLE (
  id BIGINT,
  note_type TEXT,
  note_text TEXT,
  chapter_number TEXT,
  anchor TEXT,
  page_number INTEGER,
  combined_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  k CONSTANT INT := 60;
  embedding_vector extensions.vector(1536);
BEGIN
  embedding_vector := query_embedding::extensions.vector;
  
  RETURN QUERY
  WITH semantic_results AS (
    SELECT 
      tn.id,
      tn.note_type,
      tn.note_text,
      tn.chapter_number,
      tn.anchor,
      tn.page_number,
      1 - (tn.embedding <=> embedding_vector) as sem_score,
      ROW_NUMBER() OVER (ORDER BY tn.embedding <=> embedding_vector) as sem_rank
    FROM public.tariff_notes tn
    WHERE 
      tn.embedding IS NOT NULL
      AND (chapter_filters IS NULL OR tn.chapter_number = ANY(chapter_filters))
    ORDER BY tn.embedding <=> embedding_vector
    LIMIT 30
  ),
  fts_results AS (
    SELECT 
      tn.id,
      tn.note_type,
      tn.note_text,
      tn.chapter_number,
      tn.anchor,
      tn.page_number,
      ts_rank_cd(
        to_tsvector('french', COALESCE(tn.note_text, '')), 
        plainto_tsquery('french', query_text),
        32
      ) as fts_sc,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('french', COALESCE(tn.note_text, '')), 
          plainto_tsquery('french', query_text),
          32
        ) DESC
      ) as fts_rank
    FROM public.tariff_notes tn
    WHERE 
      query_text IS NOT NULL 
      AND query_text != ''
      AND to_tsvector('french', COALESCE(tn.note_text, '')) @@ plainto_tsquery('french', query_text)
      AND (chapter_filters IS NULL OR tn.chapter_number = ANY(chapter_filters))
    ORDER BY fts_sc DESC
    LIMIT 30
  )
  SELECT 
    COALESCE(s.id, f.id) as id,
    COALESCE(s.note_type, f.note_type) as note_type,
    COALESCE(s.note_text, f.note_text) as note_text,
    COALESCE(s.chapter_number, f.chapter_number) as chapter_number,
    COALESCE(s.anchor, f.anchor) as anchor,
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

-- ============================================
-- 3. FUNCTION: search_legal_chunks_hybrid
-- ============================================
CREATE OR REPLACE FUNCTION public.search_legal_chunks_hybrid(
  query_text TEXT,
  query_embedding TEXT,
  semantic_weight FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  source_id BIGINT,
  chunk_text TEXT,
  article_number VARCHAR(50),
  section_title TEXT,
  chunk_type VARCHAR(50),
  combined_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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
      1 - (lc.embedding <=> embedding_vector) as sem_score,
      ROW_NUMBER() OVER (ORDER BY lc.embedding <=> embedding_vector) as sem_rank
    FROM public.legal_chunks lc
    WHERE lc.embedding IS NOT NULL
    ORDER BY lc.embedding <=> embedding_vector
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

-- ============================================
-- 4. INDEX FTS (si pas déjà présents)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_hs_codes_description_fts
ON public.hs_codes USING GIN (to_tsvector('french', COALESCE(description_fr, '')));

CREATE INDEX IF NOT EXISTS idx_legal_chunks_text_fts
ON public.legal_chunks USING GIN (to_tsvector('french', COALESCE(chunk_text, '')));

CREATE INDEX IF NOT EXISTS idx_tariff_notes_text_fts
ON public.tariff_notes USING GIN (to_tsvector('french', COALESCE(note_text, '')));

-- ============================================
-- 5. COMMENTAIRES
-- ============================================
COMMENT ON FUNCTION public.search_hs_codes_hybrid IS 'Recherche hybride RRF combinant sémantique et FTS pour les codes SH';
COMMENT ON FUNCTION public.search_tariff_notes_hybrid IS 'Recherche hybride RRF pour les notes tarifaires';
COMMENT ON FUNCTION public.search_legal_chunks_hybrid IS 'Recherche hybride RRF pour les chunks légaux (Code des Douanes)';