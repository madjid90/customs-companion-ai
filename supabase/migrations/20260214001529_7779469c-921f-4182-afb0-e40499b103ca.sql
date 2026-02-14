
CREATE OR REPLACE FUNCTION public.get_circulars_missing_chunks()
RETURNS TABLE(
  pdf_id uuid,
  title text,
  file_path text,
  file_name text,
  publication_date date,
  reference_number varchar,
  source_id bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 
    pd.id AS pdf_id,
    pd.title,
    pd.file_path,
    pd.file_name,
    pd.publication_date,
    COALESCE(lr.reference_number, pd.document_reference)::varchar AS reference_number,
    ls.id AS source_id
  FROM pdf_documents pd
  -- Try legal_references first
  LEFT JOIN legal_references lr ON lr.pdf_id = pd.id
  -- Try legal_sources via legal_references OR via document_reference directly
  LEFT JOIN legal_sources ls 
    ON ls.source_ref = COALESCE(lr.reference_number, pd.document_reference)
  -- Check for chunks
  LEFT JOIN legal_chunks lc ON lc.source_id = ls.id
  WHERE pd.category ILIKE '%circulaire%' 
    AND pd.is_active = true
    -- Only those with NO chunks
    AND lc.id IS NULL
    -- Exclude documents that already have chunks via a different source match
    AND NOT EXISTS (
      SELECT 1 FROM legal_sources ls2
      JOIN legal_chunks lc2 ON lc2.source_id = ls2.id
      WHERE ls2.source_ref = COALESCE(pd.document_reference, replace(pd.file_name, '.pdf', ''))
    )
  GROUP BY pd.id, pd.title, pd.file_path, pd.file_name, pd.publication_date, 
           lr.reference_number, pd.document_reference, ls.id
  ORDER BY pd.title;
$$;
