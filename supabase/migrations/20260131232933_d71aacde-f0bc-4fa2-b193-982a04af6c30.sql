-- Add embedding column to tariff_notes for semantic search
ALTER TABLE public.tariff_notes 
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_tariff_notes_embedding 
ON public.tariff_notes 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- Create GIN index for full-text search on note_text
CREATE INDEX IF NOT EXISTS idx_tariff_notes_text_fts
ON public.tariff_notes
USING GIN (to_tsvector('french', note_text));

-- Create semantic search function for tariff notes
CREATE OR REPLACE FUNCTION public.search_tariff_notes_semantic(
  query_embedding text,
  match_threshold double precision DEFAULT 0.65,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id bigint,
  note_type text,
  note_text text,
  chapter_number text,
  anchor text,
  page_number integer,
  country_code text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tn.id,
    tn.note_type,
    tn.note_text,
    tn.chapter_number,
    tn.anchor,
    tn.page_number,
    tn.country_code,
    1 - (tn.embedding <=> query_embedding::vector) AS similarity
  FROM public.tariff_notes tn
  WHERE tn.embedding IS NOT NULL
    AND 1 - (tn.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY tn.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;

-- Create FTS search function for tariff notes (fallback)
CREATE OR REPLACE FUNCTION public.search_tariff_notes_fts(
  search_query text,
  chapter_filter text DEFAULT NULL,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id bigint,
  note_type text,
  note_text text,
  chapter_number text,
  anchor text,
  page_number integer,
  country_code text,
  relevance_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  tsquery_val tsquery;
BEGIN
  -- Convert search query to tsquery
  BEGIN
    tsquery_val := websearch_to_tsquery('french', search_query);
  EXCEPTION WHEN OTHERS THEN
    tsquery_val := plainto_tsquery('french', search_query);
  END;

  RETURN QUERY
  SELECT 
    tn.id,
    tn.note_type,
    tn.note_text,
    tn.chapter_number,
    tn.anchor,
    tn.page_number,
    tn.country_code,
    ts_rank_cd(
      to_tsvector('french', tn.note_text),
      tsquery_val,
      32
    )::real AS relevance_score
  FROM public.tariff_notes tn
  WHERE 
    to_tsvector('french', tn.note_text) @@ tsquery_val
    AND (chapter_filter IS NULL OR tn.chapter_number = chapter_filter)
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

-- Enable RLS on tariff_notes
ALTER TABLE public.tariff_notes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Tariff notes are publicly readable" 
ON public.tariff_notes 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage tariff_notes" 
ON public.tariff_notes 
FOR ALL 
USING (true)
WITH CHECK (true);