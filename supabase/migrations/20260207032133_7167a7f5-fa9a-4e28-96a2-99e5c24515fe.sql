-- Fix: Convertir la vue en vue standard (pas SECURITY DEFINER)
DROP VIEW IF EXISTS public.documents_missing_embeddings;

CREATE VIEW public.documents_missing_embeddings WITH (security_invoker = true) AS
SELECT 'hs_codes' as table_name, COUNT(*) as count
FROM hs_codes WHERE embedding IS NULL AND is_active = true
UNION ALL
SELECT 'knowledge_documents', COUNT(*)
FROM knowledge_documents WHERE embedding IS NULL AND is_active = true
UNION ALL
SELECT 'tariff_notes', COUNT(*)
FROM tariff_notes WHERE embedding IS NULL
UNION ALL
SELECT 'legal_chunks', COUNT(*)
FROM legal_chunks WHERE embedding IS NULL AND is_active = true;

-- Fix search_path on the new functions
CREATE OR REPLACE FUNCTION public.check_embedding_coverage()
RETURNS TABLE(
  table_name TEXT,
  total_records BIGINT,
  with_embedding BIGINT,
  coverage_percent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'hs_codes'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(embedding)::BIGINT,
    ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 1)
  FROM hs_codes WHERE is_active = true
  UNION ALL
  SELECT 
    'knowledge_documents'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(embedding)::BIGINT,
    ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 1)
  FROM knowledge_documents WHERE is_active = true
  UNION ALL
  SELECT 
    'tariff_notes'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(embedding)::BIGINT,
    ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 1)
  FROM tariff_notes
  UNION ALL
  SELECT 
    'legal_chunks'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(embedding)::BIGINT,
    ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 1)
  FROM legal_chunks WHERE is_active = true;
END;
$$;

-- Fix search_path on queue_for_embedding
CREATE OR REPLACE FUNCTION public.queue_for_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.embedding IS NULL THEN
    INSERT INTO public.embedding_queue (table_name, record_id, text_content)
    VALUES (
      TG_TABLE_NAME,
      NEW.id::TEXT,
      CASE TG_TABLE_NAME
        WHEN 'hs_codes' THEN COALESCE(NEW.description_fr, '')
        WHEN 'knowledge_documents' THEN COALESCE(NEW.content, '')
        WHEN 'tariff_notes' THEN COALESCE(NEW.note_text, '')
        WHEN 'legal_chunks' THEN COALESCE(NEW.chunk_text, '')
        ELSE ''
      END
    )
    ON CONFLICT (table_name, record_id) DO UPDATE
    SET text_content = EXCLUDED.text_content,
        status = 'pending',
        attempts = 0,
        error_message = NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Fix search_path on validate trigger
CREATE OR REPLACE FUNCTION public.validate_embedding_queue_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;