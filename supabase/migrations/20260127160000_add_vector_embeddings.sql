-- ============================================
-- PHASE 3: VECTOR EMBEDDINGS FOR SEMANTIC SEARCH
-- Enables AI-powered semantic search for better accuracy
-- ============================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding columns to key tables
-- Using 1536 dimensions for OpenAI text-embedding-3-small compatibility
-- Can also work with Anthropic embeddings or other providers

-- HS Codes embeddings (for semantic classification)
ALTER TABLE public.hs_codes
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE;

-- Knowledge documents embeddings (for semantic retrieval)
ALTER TABLE public.knowledge_documents
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE;

-- PDF extractions embeddings (for semantic search in PDFs)
ALTER TABLE public.pdf_extractions
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}';

-- Veille documents embeddings
ALTER TABLE public.veille_documents
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS publication_date DATE;

-- 3. Create response cache table for semantic caching
CREATE TABLE IF NOT EXISTS public.response_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_hash TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_embedding vector(1536),
  response_text TEXT NOT NULL,
  context_used JSONB DEFAULT '{}',
  confidence_level VARCHAR(20),
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. Create indexes for vector similarity search (using IVFFlat for performance)
-- Note: IVFFlat requires data to exist before index creation for best results
-- These indexes use cosine distance (<=>)

CREATE INDEX IF NOT EXISTS idx_hs_codes_embedding
ON public.hs_codes USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_embedding
ON public.knowledge_documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_pdf_extractions_embedding
ON public.pdf_extractions USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_veille_docs_embedding
ON public.veille_documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_response_cache_embedding
ON public.response_cache USING ivfflat (question_embedding vector_cosine_ops)
WITH (lists = 50);

-- 5. Create full-text search indexes on veille_documents
CREATE INDEX IF NOT EXISTS idx_veille_documents_title_fts
ON public.veille_documents USING GIN (to_tsvector('french', COALESCE(title, '')));

CREATE INDEX IF NOT EXISTS idx_veille_documents_content_fts
ON public.veille_documents USING GIN (to_tsvector('french', COALESCE(content, '')));

CREATE INDEX IF NOT EXISTS idx_veille_documents_summary_fts
ON public.veille_documents USING GIN (to_tsvector('french', COALESCE(summary, '')));

-- 6. Create semantic search functions

-- Function to search HS codes by semantic similarity
CREATE OR REPLACE FUNCTION search_hs_codes_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  code varchar(20),
  code_clean varchar(20),
  description_fr text,
  description_en text,
  chapter_number integer,
  level varchar(20),
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    hs.id,
    hs.code,
    hs.code_clean,
    hs.description_fr,
    hs.description_en,
    hs.chapter_number,
    hs.level,
    1 - (hs.embedding <=> query_embedding) as similarity
  FROM public.hs_codes hs
  WHERE
    hs.embedding IS NOT NULL
    AND hs.is_active = true
    AND 1 - (hs.embedding <=> query_embedding) > match_threshold
  ORDER BY hs.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to search knowledge documents by semantic similarity
CREATE OR REPLACE FUNCTION search_knowledge_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.6,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  category varchar(50),
  source_url text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kd.id,
    kd.title,
    kd.content,
    kd.category,
    kd.source_url,
    1 - (kd.embedding <=> query_embedding) as similarity
  FROM public.knowledge_documents kd
  WHERE
    kd.embedding IS NOT NULL
    AND kd.is_active = true
    AND 1 - (kd.embedding <=> query_embedding) > match_threshold
  ORDER BY kd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to search PDF extractions by semantic similarity
CREATE OR REPLACE FUNCTION search_pdfs_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.6,
  match_count int DEFAULT 5
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
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id,
    pe.pdf_id,
    pe.summary,
    pe.extracted_text,
    pe.key_points,
    1 - (pe.embedding <=> query_embedding) as similarity
  FROM public.pdf_extractions pe
  WHERE
    pe.embedding IS NOT NULL
    AND 1 - (pe.embedding <=> query_embedding) > match_threshold
  ORDER BY pe.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to search veille documents by semantic similarity
CREATE OR REPLACE FUNCTION search_veille_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.6,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  summary text,
  content text,
  source_url text,
  category varchar(50),
  importance varchar(20),
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vd.id,
    vd.title,
    vd.summary,
    vd.content,
    vd.source_url,
    vd.category,
    vd.importance,
    1 - (vd.embedding <=> query_embedding) as similarity
  FROM public.veille_documents vd
  WHERE
    vd.embedding IS NOT NULL
    AND vd.status = 'approved'
    AND 1 - (vd.embedding <=> query_embedding) > match_threshold
  ORDER BY vd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to find cached response by semantic similarity
CREATE OR REPLACE FUNCTION find_cached_response(
  query_embedding vector(1536),
  similarity_threshold float DEFAULT 0.92
)
RETURNS TABLE (
  id uuid,
  question_text text,
  response_text text,
  context_used jsonb,
  confidence_level varchar(20),
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.id,
    rc.question_text,
    rc.response_text,
    rc.context_used,
    rc.confidence_level,
    1 - (rc.question_embedding <=> query_embedding) as similarity
  FROM public.response_cache rc
  WHERE
    rc.question_embedding IS NOT NULL
    AND rc.is_active = true
    AND (rc.expires_at IS NULL OR rc.expires_at > now())
    AND 1 - (rc.question_embedding <=> query_embedding) > similarity_threshold
  ORDER BY rc.question_embedding <=> query_embedding
  LIMIT 1;
END;
$$;

-- Function to update cache hit count
CREATE OR REPLACE FUNCTION update_cache_hit(cache_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.response_cache
  SET
    hit_count = hit_count + 1,
    last_hit_at = now()
  WHERE id = cache_id;
END;
$$;

-- 7. Add RLS policies for response_cache
ALTER TABLE public.response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Response cache is readable" ON public.response_cache
  FOR SELECT USING (is_active = true);

CREATE POLICY "Service role can manage response_cache" ON public.response_cache
  FOR ALL USING (true) WITH CHECK (true);

-- 8. Add trigger for updated_at on response_cache
CREATE TRIGGER update_response_cache_updated_at
  BEFORE UPDATE ON public.response_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Comments for documentation
COMMENT ON TABLE public.response_cache IS 'Cache for AI responses to enable faster repeated queries via semantic similarity';
COMMENT ON FUNCTION search_hs_codes_semantic IS 'Search HS codes using vector similarity for semantic classification';
COMMENT ON FUNCTION search_knowledge_semantic IS 'Search knowledge documents using vector similarity';
COMMENT ON FUNCTION search_pdfs_semantic IS 'Search PDF extractions using vector similarity';
COMMENT ON FUNCTION search_veille_semantic IS 'Search veille documents using vector similarity';
COMMENT ON FUNCTION find_cached_response IS 'Find semantically similar cached response to avoid redundant API calls';
