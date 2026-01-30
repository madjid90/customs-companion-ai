
-- Create optimized RPC function to search PDFs by HS code chapter prefixes
CREATE OR REPLACE FUNCTION public.search_pdf_by_chapter_prefixes(prefixes text[])
RETURNS TABLE (
  extraction_id uuid,
  pdf_id uuid,
  pdf_title text,
  pdf_file_path text,
  pdf_category varchar,
  summary text,
  extracted_text text,
  key_points jsonb,
  mentioned_hs_codes jsonb,
  chapter_number int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (pe.pdf_id)
    pe.id as extraction_id,
    pe.pdf_id,
    pd.title as pdf_title,
    pd.file_path as pdf_file_path,
    pd.category as pdf_category,
    pe.summary,
    LEFT(pe.extracted_text, 8000) as extracted_text,
    pe.key_points,
    pe.mentioned_hs_codes,
    -- Extract chapter number from first matching code
    (
      SELECT CAST(LEFT(REGEXP_REPLACE(code::text, '[^0-9]', '', 'g'), 2) AS int)
      FROM jsonb_array_elements_text(pe.mentioned_hs_codes) AS code
      WHERE EXISTS (
        SELECT 1 FROM unnest(prefixes) AS p
        WHERE REGEXP_REPLACE(code::text, '[^0-9]', '', 'g') LIKE p || '%'
      )
      LIMIT 1
    ) as chapter_number
  FROM pdf_extractions pe
  JOIN pdf_documents pd ON pd.id = pe.pdf_id
  WHERE pd.category = 'tarif'
    AND pd.is_active = true
    AND EXISTS (
      SELECT 1 
      FROM jsonb_array_elements_text(pe.mentioned_hs_codes) AS code
      WHERE EXISTS (
        SELECT 1 FROM unnest(prefixes) AS p
        WHERE REGEXP_REPLACE(code::text, '[^0-9]', '', 'g') LIKE p || '%'
      )
    )
  ORDER BY pe.pdf_id, pe.created_at DESC;
END;
$$;

-- Create index to speed up JSONB array searches on mentioned_hs_codes
CREATE INDEX IF NOT EXISTS idx_pdf_extractions_mentioned_hs_codes_gin 
ON pdf_extractions USING GIN (mentioned_hs_codes);

-- Add comment for documentation
COMMENT ON FUNCTION public.search_pdf_by_chapter_prefixes IS 
'Searches PDF extractions by HS code chapter prefixes (e.g., ["84", "85"]). Returns PDFs containing codes starting with any of the given prefixes.';
