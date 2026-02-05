-- Drop and recreate the find_cached_response function with new return type
DROP FUNCTION IF EXISTS public.find_cached_response(text, double precision);

CREATE FUNCTION public.find_cached_response(query_embedding text, similarity_threshold double precision DEFAULT 0.94)
 RETURNS TABLE(id uuid, question_text text, response_text text, context_used jsonb, confidence_level character varying, similarity double precision, cited_circulars jsonb, has_db_evidence boolean, validation_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    rc.id,
    rc.question_text,
    rc.response_text,
    rc.context_used,
    rc.confidence_level,
    1 - (rc.question_embedding <=> query_embedding::vector) AS similarity,
    COALESCE(rc.cited_circulars, '[]'::jsonb) AS cited_circulars,
    COALESCE(rc.has_db_evidence, true) AS has_db_evidence,
    rc.validation_message
  FROM public.response_cache rc
  WHERE rc.question_embedding IS NOT NULL
    AND rc.expires_at > now()
    AND 1 - (rc.question_embedding <=> query_embedding::vector) > similarity_threshold
  ORDER BY rc.question_embedding <=> query_embedding::vector
  LIMIT 1;
END;
$function$;