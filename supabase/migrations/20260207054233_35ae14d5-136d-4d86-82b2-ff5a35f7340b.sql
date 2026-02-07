
-- Drop the shared trigger function and create separate ones per table

-- 1. Drop existing triggers
DROP TRIGGER IF EXISTS trg_legal_chunks_embedding ON public.legal_chunks;
DROP TRIGGER IF EXISTS trg_tariff_notes_embedding ON public.tariff_notes;
DROP TRIGGER IF EXISTS trg_hs_codes_embedding ON public.hs_codes;
DROP TRIGGER IF EXISTS trg_knowledge_documents_embedding ON public.knowledge_documents;

-- 2. Drop old shared function
DROP FUNCTION IF EXISTS public.queue_for_embedding() CASCADE;

-- 3. Create dedicated function for legal_chunks
CREATE OR REPLACE FUNCTION public.queue_legal_chunk_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.embedding IS NULL THEN
    INSERT INTO public.embedding_queue (table_name, record_id, text_content)
    VALUES ('legal_chunks', NEW.id::TEXT, COALESCE(NEW.chunk_text, ''))
    ON CONFLICT (table_name, record_id) DO UPDATE
    SET text_content = EXCLUDED.text_content,
        status = 'pending',
        attempts = 0,
        error_message = NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Create dedicated function for tariff_notes
CREATE OR REPLACE FUNCTION public.queue_tariff_note_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.embedding IS NULL THEN
    INSERT INTO public.embedding_queue (table_name, record_id, text_content)
    VALUES ('tariff_notes', NEW.id::TEXT, COALESCE(NEW.note_text, ''))
    ON CONFLICT (table_name, record_id) DO UPDATE
    SET text_content = EXCLUDED.text_content,
        status = 'pending',
        attempts = 0,
        error_message = NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Create dedicated function for hs_codes
CREATE OR REPLACE FUNCTION public.queue_hs_code_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.embedding IS NULL THEN
    INSERT INTO public.embedding_queue (table_name, record_id, text_content)
    VALUES ('hs_codes', NEW.id::TEXT, COALESCE(NEW.description_fr, ''))
    ON CONFLICT (table_name, record_id) DO UPDATE
    SET text_content = EXCLUDED.text_content,
        status = 'pending',
        attempts = 0,
        error_message = NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Create dedicated function for knowledge_documents
CREATE OR REPLACE FUNCTION public.queue_knowledge_doc_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.embedding IS NULL THEN
    INSERT INTO public.embedding_queue (table_name, record_id, text_content)
    VALUES ('knowledge_documents', NEW.id::TEXT, COALESCE(NEW.content, ''))
    ON CONFLICT (table_name, record_id) DO UPDATE
    SET text_content = EXCLUDED.text_content,
        status = 'pending',
        attempts = 0,
        error_message = NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 7. Re-create triggers with dedicated functions
CREATE TRIGGER trg_legal_chunks_embedding
  AFTER INSERT OR UPDATE OF chunk_text ON public.legal_chunks
  FOR EACH ROW EXECUTE FUNCTION public.queue_legal_chunk_embedding();

CREATE TRIGGER trg_tariff_notes_embedding
  AFTER INSERT OR UPDATE OF note_text ON public.tariff_notes
  FOR EACH ROW EXECUTE FUNCTION public.queue_tariff_note_embedding();

CREATE TRIGGER trg_hs_codes_embedding
  AFTER INSERT OR UPDATE OF description_fr ON public.hs_codes
  FOR EACH ROW EXECUTE FUNCTION public.queue_hs_code_embedding();

CREATE TRIGGER trg_knowledge_documents_embedding
  AFTER INSERT OR UPDATE OF content ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.queue_knowledge_doc_embedding();
