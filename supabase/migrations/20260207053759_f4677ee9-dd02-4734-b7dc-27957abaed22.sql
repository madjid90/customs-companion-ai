
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
        WHEN 'legal_chunks' THEN COALESCE(NEW.chunk_text, '')
        WHEN 'tariff_notes' THEN COALESCE(NEW.note_text, '')
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
