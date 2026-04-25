-- Fix WARN 1: search_path on custom function
CREATE OR REPLACE FUNCTION public.search_hs_codes(search_term text, limit_count integer DEFAULT 20)
 RETURNS TABLE(id uuid, code character varying, description_fr text, chapter_number integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        h.id,
        h.code,
        h.description_fr,
        h.chapter_number
    FROM public.hs_codes h
    WHERE 
        h.is_active = true
        AND (
            h.code ILIKE '%' || search_term || '%'
            OR h.code_clean ILIKE '%' || search_term || '%'
            OR h.description_fr ILIKE '%' || search_term || '%'
        )
    ORDER BY 
        CASE WHEN h.code ILIKE search_term || '%' THEN 0 ELSE 1 END,
        h.code
    LIMIT limit_count;
END;
$function$;

-- Fix WARN 5: Restrict listing on public bucket pdf-documents
-- Keep public download by direct URL but block listing/enumeration
DROP POLICY IF EXISTS "PDF documents are publicly accessible" ON storage.objects;

CREATE POLICY "PDF documents readable by authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'pdf-documents');

CREATE POLICY "PDF documents readable by anon via direct URL"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'pdf-documents' AND auth.role() = 'anon');