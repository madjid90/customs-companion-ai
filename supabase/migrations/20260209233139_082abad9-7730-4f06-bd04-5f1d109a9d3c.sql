
-- Function to get all legal source stats in ONE query instead of 7 * N queries
CREATE OR REPLACE FUNCTION public.get_legal_source_stats()
RETURNS TABLE (
  source_id int,
  source_ref text,
  source_title text,
  source_type text,
  total_chunks_meta int,
  is_current boolean,
  actual_chunks bigint,
  chunks_with_embeddings bigint,
  chunks_with_hierarchy bigint,
  chunks_with_keywords bigint,
  evidence_count bigint,
  distinct_pages bigint,
  pdf_id uuid,
  pdf_file_path text,
  pdf_file_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ls.id AS source_id,
    ls.source_ref,
    ls.title AS source_title,
    ls.source_type,
    ls.total_chunks AS total_chunks_meta,
    ls.is_current,
    COALESCE(cs.actual_chunks, 0) AS actual_chunks,
    COALESCE(cs.chunks_with_embeddings, 0) AS chunks_with_embeddings,
    COALESCE(cs.chunks_with_hierarchy, 0) AS chunks_with_hierarchy,
    COALESCE(cs.chunks_with_keywords, 0) AS chunks_with_keywords,
    COALESCE(ev.evidence_count, 0) AS evidence_count,
    COALESCE(cs.distinct_pages, 0) AS distinct_pages,
    pd.id AS pdf_id,
    pd.file_path AS pdf_file_path,
    pd.file_name AS pdf_file_name
  FROM legal_sources ls
  LEFT JOIN LATERAL (
    SELECT 
      COUNT(*) AS actual_chunks,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS chunks_with_embeddings,
      COUNT(*) FILTER (WHERE hierarchy_path IS NOT NULL) AS chunks_with_hierarchy,
      COUNT(*) FILTER (WHERE keywords IS NOT NULL) AS chunks_with_keywords,
      COUNT(DISTINCT page_number) FILTER (WHERE page_number IS NOT NULL) AS distinct_pages
    FROM legal_chunks lc
    WHERE lc.source_id = ls.id
  ) cs ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS evidence_count
    FROM hs_evidence he
    WHERE he.source_id = ls.id
  ) ev ON true
  LEFT JOIN LATERAL (
    SELECT pd2.id, pd2.file_path, pd2.file_name
    FROM pdf_documents pd2
    WHERE pd2.is_active = true
      AND (
        pd2.document_reference = ls.source_ref
        OR pd2.title ILIKE '%' || LEFT(COALESCE(ls.title, ls.source_ref), 30) || '%'
      )
    LIMIT 1
  ) pd ON true
  ORDER BY ls.id ASC;
$$;
