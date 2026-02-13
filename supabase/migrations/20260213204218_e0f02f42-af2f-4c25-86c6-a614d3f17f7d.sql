
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Circulars with legal_references but no chunks
  SELECT 
    pd.id AS pdf_id,
    pd.title,
    pd.file_path,
    pd.file_name,
    pd.publication_date,
    lr.reference_number,
    ls.id AS source_id
  FROM pdf_documents pd
  JOIN legal_references lr ON lr.pdf_id = pd.id
  LEFT JOIN legal_sources ls ON ls.source_ref = lr.reference_number
  LEFT JOIN legal_chunks lc ON lc.source_id = ls.id
  WHERE pd.category ILIKE '%circulaire%' 
    AND pd.is_active = true 
    AND lc.id IS NULL

  UNION ALL

  -- Orphan circulars (no legal_references at all)
  SELECT 
    pd.id AS pdf_id,
    pd.title,
    pd.file_path,
    pd.file_name,
    pd.publication_date,
    NULL::varchar AS reference_number,
    NULL::bigint AS source_id
  FROM pdf_documents pd
  LEFT JOIN legal_references lr ON lr.pdf_id = pd.id
  WHERE pd.category ILIKE '%circulaire%' 
    AND pd.is_active = true 
    AND lr.id IS NULL

  ORDER BY title;
$$;
