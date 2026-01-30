-- Create GIN index for full-text search on pdf_extractions
CREATE INDEX IF NOT EXISTS idx_pdf_extractions_fts 
ON public.pdf_extractions 
USING GIN (to_tsvector('french', COALESCE(summary, '') || ' ' || COALESCE(extracted_text, '')));

-- Create RPC function for keyword fallback search on PDFs
CREATE OR REPLACE FUNCTION public.search_pdf_extractions_keyword(
  search_query text,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  pdf_id uuid,
  summary text,
  extracted_text text,
  key_points jsonb,
  relevance_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.pdf_id,
    p.summary,
    LEFT(p.extracted_text, 2000) AS extracted_text,
    p.key_points,
    ts_rank(
      to_tsvector('french', COALESCE(p.summary, '') || ' ' || COALESCE(p.extracted_text, '')),
      plainto_tsquery('french', search_query)
    ) AS relevance_score
  FROM public.pdf_extractions p
  WHERE 
    to_tsvector('french', COALESCE(p.summary, '') || ' ' || COALESCE(p.extracted_text, ''))
    @@ plainto_tsquery('french', search_query)
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;