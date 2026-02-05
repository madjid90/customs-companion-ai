-- Add cited_circulars column to response_cache for storing validated sources
ALTER TABLE public.response_cache 
ADD COLUMN IF NOT EXISTS cited_circulars jsonb DEFAULT '[]'::jsonb;

-- Add has_db_evidence column
ALTER TABLE public.response_cache 
ADD COLUMN IF NOT EXISTS has_db_evidence boolean DEFAULT true;

-- Add validation_message column
ALTER TABLE public.response_cache 
ADD COLUMN IF NOT EXISTS validation_message text;

-- Comment for documentation
COMMENT ON COLUMN public.response_cache.cited_circulars IS 'Validated source citations from the response (circulars, tariffs, articles, etc.)';
COMMENT ON COLUMN public.response_cache.has_db_evidence IS 'Whether the response has database evidence backing its claims';
COMMENT ON COLUMN public.response_cache.validation_message IS 'Message displayed when no evidence found';