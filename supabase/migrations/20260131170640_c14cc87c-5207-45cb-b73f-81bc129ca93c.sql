-- ============================================================================
-- TABLE: legal_chunks - Chunks for RAG with embeddings
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legal_chunks (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES public.legal_sources(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  page_number INT NULL,
  char_start INT NULL,
  char_end INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS legal_chunks_source_idx ON public.legal_chunks(source_id);
CREATE INDEX IF NOT EXISTS legal_chunks_page_idx ON public.legal_chunks(source_id, page_number);

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS legal_chunks_embedding_idx 
  ON public.legal_chunks 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Enable RLS
ALTER TABLE public.legal_chunks ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "legal_chunks_public_read" 
  ON public.legal_chunks 
  FOR SELECT 
  USING (true);

-- Service role write access
CREATE POLICY "legal_chunks_service_write" 
  ON public.legal_chunks 
  FOR ALL 
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Function: Semantic search on legal_chunks
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_legal_chunks_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  source_id bigint,
  chunk_text text,
  page_number integer,
  source_type text,
  source_ref text,
  issuer text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lc.id,
    lc.source_id,
    lc.chunk_text,
    lc.page_number,
    ls.source_type,
    ls.source_ref,
    ls.issuer,
    1 - (lc.embedding <=> query_embedding::vector) AS similarity
  FROM public.legal_chunks lc
  JOIN public.legal_sources ls ON ls.id = lc.source_id
  WHERE lc.embedding IS NOT NULL
    AND 1 - (lc.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY lc.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;