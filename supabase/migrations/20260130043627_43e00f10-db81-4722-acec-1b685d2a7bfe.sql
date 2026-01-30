-- ============================================================================
-- TABLE: response_cache - Cache sémantique des réponses pour éviter les appels API répétés
-- ============================================================================

CREATE TABLE public.response_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_hash TEXT NOT NULL UNIQUE,
  question_text TEXT NOT NULL,
  question_embedding vector(1536),
  response_text TEXT NOT NULL,
  context_used JSONB DEFAULT '{}'::jsonb,
  confidence_level VARCHAR(20) DEFAULT 'medium',
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

-- Index pour la recherche sémantique vectorielle
CREATE INDEX idx_response_cache_embedding ON public.response_cache 
USING ivfflat (question_embedding vector_cosine_ops) WITH (lists = 50);

-- Index pour le nettoyage des entrées expirées
CREATE INDEX idx_response_cache_expires_at ON public.response_cache (expires_at);

-- Index pour le hash de question (recherche exacte)
CREATE INDEX idx_response_cache_question_hash ON public.response_cache (question_hash);

-- Trigger pour updated_at
CREATE TRIGGER update_response_cache_updated_at
  BEFORE UPDATE ON public.response_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.response_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can manage cache
CREATE POLICY "Service role can manage response_cache"
  ON public.response_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- FUNCTION: find_cached_response - Recherche sémantique dans le cache
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_cached_response(
  query_embedding vector(1536),
  similarity_threshold DOUBLE PRECISION DEFAULT 0.94
)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  response_text TEXT,
  context_used JSONB,
  confidence_level VARCHAR(20),
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rc.id,
    rc.question_text,
    rc.response_text,
    rc.context_used,
    rc.confidence_level,
    1 - (rc.question_embedding <=> query_embedding) AS similarity
  FROM public.response_cache rc
  WHERE rc.question_embedding IS NOT NULL
    AND rc.expires_at > now()
    AND 1 - (rc.question_embedding <=> query_embedding) > similarity_threshold
  ORDER BY rc.question_embedding <=> query_embedding
  LIMIT 1;
END;
$$;

-- ============================================================================
-- FUNCTION: update_cache_hit - Incrémente le compteur de hits
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_cache_hit(cache_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.response_cache
  SET 
    hit_count = hit_count + 1,
    updated_at = now()
  WHERE id = cache_id;
END;
$$;

-- ============================================================================
-- FUNCTION: cleanup_expired_cache - Nettoie les entrées expirées
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.response_cache
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;