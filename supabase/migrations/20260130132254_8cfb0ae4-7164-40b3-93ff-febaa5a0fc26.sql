-- Create GIN index for Full-Text Search on pdf_extractions
-- This will significantly speed up keyword searches on extracted_text and summary

-- Drop existing index if any (to avoid conflicts)
DROP INDEX IF EXISTS idx_pdf_extractions_fts;

-- Create a composite FTS index on both summary and extracted_text using French configuration
CREATE INDEX idx_pdf_extractions_fts 
ON public.pdf_extractions 
USING GIN (
  to_tsvector('french', COALESCE(summary, '') || ' ' || COALESCE(extracted_text, ''))
);

-- Also create a separate index on extracted_text alone for more targeted searches
DROP INDEX IF EXISTS idx_pdf_extractions_text_fts;
CREATE INDEX idx_pdf_extractions_text_fts 
ON public.pdf_extractions 
USING GIN (to_tsvector('french', COALESCE(extracted_text, '')));

-- Create index on summary for quick summary-only searches
DROP INDEX IF EXISTS idx_pdf_extractions_summary_fts;
CREATE INDEX idx_pdf_extractions_summary_fts 
ON public.pdf_extractions 
USING GIN (to_tsvector('french', COALESCE(summary, '')));

-- Update the search function to use websearch_to_tsquery for better natural language support
CREATE OR REPLACE FUNCTION public.search_pdf_extractions_keyword(
  search_query text, 
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid, 
  pdf_id uuid, 
  summary text, 
  extracted_text text, 
  key_points jsonb, 
  relevance_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tsquery_val tsquery;
BEGIN
  -- Convert search query to tsquery, handling special characters
  -- Try websearch first, fallback to plainto if it fails
  BEGIN
    tsquery_val := websearch_to_tsquery('french', search_query);
  EXCEPTION WHEN OTHERS THEN
    tsquery_val := plainto_tsquery('french', search_query);
  END;

  RETURN QUERY
  SELECT 
    p.id,
    p.pdf_id,
    p.summary,
    LEFT(p.extracted_text, 3000) AS extracted_text,
    p.key_points,
    (
      ts_rank_cd(
        to_tsvector('french', COALESCE(p.summary, '') || ' ' || COALESCE(p.extracted_text, '')),
        tsquery_val,
        32 -- Normalization: divide by document length
      ) * 10
    )::real AS relevance_score
  FROM public.pdf_extractions p
  WHERE 
    to_tsvector('french', COALESCE(p.summary, '') || ' ' || COALESCE(p.extracted_text, ''))
    @@ tsquery_val
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$function$;

-- Create a new function for searching legal references by keyword (for circulaires)
CREATE OR REPLACE FUNCTION public.search_legal_references_fts(
  search_query text, 
  limit_count integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, 
  reference_type character varying, 
  reference_number text, 
  title text, 
  reference_date date, 
  context character varying, 
  pdf_title text, 
  pdf_category character varying, 
  pdf_id uuid,
  relevance_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    lr.id,
    lr.reference_type,
    lr.reference_number,
    lr.title,
    lr.reference_date,
    lr.context,
    pd.title AS pdf_title,
    pd.category AS pdf_category,
    pd.id AS pdf_id,
    (
      CASE 
        WHEN lr.reference_number ILIKE '%' || search_query || '%' THEN 1.0
        WHEN lr.title ILIKE '%' || search_query || '%' THEN 0.8
        ELSE 0.5
      END
    )::real AS relevance_score
  FROM legal_references lr
  JOIN pdf_documents pd ON pd.id = lr.pdf_id
  WHERE lr.is_active = true
    AND pd.is_active = true
    AND (
      lr.reference_number ILIKE '%' || search_query || '%'
      OR lr.title ILIKE '%' || search_query || '%'
      OR lr.reference_type ILIKE '%' || search_query || '%'
      OR lr.context ILIKE '%' || search_query || '%'
    )
  ORDER BY relevance_score DESC, lr.reference_date DESC NULLS LAST
  LIMIT limit_count;
END;
$function$;