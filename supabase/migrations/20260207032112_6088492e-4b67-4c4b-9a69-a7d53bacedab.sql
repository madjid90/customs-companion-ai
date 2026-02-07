-- ============================================================================
-- ACTION 4: RAG & INDEXATION - EMBEDDING QUEUE, COVERAGE MONITORING
-- ============================================================================

-- 4.3 Vue pour voir les documents sans embedding
CREATE OR REPLACE VIEW public.documents_missing_embeddings AS
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

-- 4.3 Fonction pour vérifier la couverture des embeddings
CREATE OR REPLACE FUNCTION public.check_embedding_coverage()
RETURNS TABLE(
  table_name TEXT,
  total_records BIGINT,
  with_embedding BIGINT,
  coverage_percent NUMERIC
) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.5 Table de queue d'embeddings (pour traitement asynchrone)
CREATE TABLE IF NOT EXISTS public.embedding_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  text_content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(table_name, record_id)
);

-- Validation du status via trigger plutôt que CHECK
CREATE OR REPLACE FUNCTION public.validate_embedding_queue_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_embedding_queue_status
  BEFORE INSERT OR UPDATE ON public.embedding_queue
  FOR EACH ROW EXECUTE FUNCTION public.validate_embedding_queue_status();

CREATE INDEX IF NOT EXISTS idx_embedding_queue_status ON public.embedding_queue(status, created_at);

-- Enable RLS
ALTER TABLE public.embedding_queue ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Service role only for embedding_queue"
  ON public.embedding_queue FOR ALL
  USING (false);

-- 4.5 Fonction trigger générique pour queue automatique
CREATE OR REPLACE FUNCTION public.queue_for_embedding()
RETURNS TRIGGER AS $$
BEGIN
  -- Seulement si embedding est null
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers sur chaque table (avec DROP IF EXISTS pour idempotence)
DROP TRIGGER IF EXISTS trg_hs_codes_embedding ON hs_codes;
CREATE TRIGGER trg_hs_codes_embedding
  AFTER INSERT OR UPDATE OF description_fr ON hs_codes
  FOR EACH ROW EXECUTE FUNCTION public.queue_for_embedding();

DROP TRIGGER IF EXISTS trg_knowledge_docs_embedding ON knowledge_documents;
CREATE TRIGGER trg_knowledge_docs_embedding
  AFTER INSERT OR UPDATE OF content ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.queue_for_embedding();

DROP TRIGGER IF EXISTS trg_tariff_notes_embedding ON tariff_notes;
CREATE TRIGGER trg_tariff_notes_embedding
  AFTER INSERT OR UPDATE OF note_text ON tariff_notes
  FOR EACH ROW EXECUTE FUNCTION public.queue_for_embedding();

DROP TRIGGER IF EXISTS trg_legal_chunks_embedding ON legal_chunks;
CREATE TRIGGER trg_legal_chunks_embedding
  AFTER INSERT OR UPDATE OF chunk_text ON legal_chunks
  FOR EACH ROW EXECUTE FUNCTION public.queue_for_embedding();