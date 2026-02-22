
-- Fix search_path for search_anrt_equipment function
CREATE OR REPLACE FUNCTION search_anrt_equipment(
  p_brand TEXT DEFAULT NULL,
  p_query TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id INTEGER,
  designation TEXT,
  brand TEXT,
  type_ref TEXT,
  model TEXT,
  approval_number TEXT,
  relevance REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id::INTEGER,
    e.designation,
    e.brand,
    e.type_ref,
    e.model,
    e.approval_number,
    CASE 
      WHEN p_query IS NOT NULL THEN
        ts_rank(to_tsvector('french', e.search_text), plainto_tsquery('french', p_query))
      ELSE 1.0
    END::REAL as relevance
  FROM public.anrt_approved_equipment e
  WHERE e.is_active = true
    AND (p_brand IS NULL OR e.brand_normalized ILIKE '%' || UPPER(TRIM(p_brand)) || '%')
    AND (p_query IS NULL OR to_tsvector('french', e.search_text) @@ plainto_tsquery('french', p_query))
  ORDER BY relevance DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
