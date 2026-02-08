
-- ============================================================================
-- 1. Table hs_code_synonyms - Correspondance produit ↔ code SH
-- ============================================================================
CREATE TABLE public.hs_code_synonyms (
  id SERIAL PRIMARY KEY,
  hs_code TEXT NOT NULL,
  synonym_fr TEXT,
  synonym_ar TEXT,
  synonym_en TEXT,
  category TEXT, -- "produit_courant", "nom_technique", "nom_commercial"
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.hs_code_synonyms ENABLE ROW LEVEL SECURITY;

-- Public read access (reference data)
CREATE POLICY "Anyone can read hs_code_synonyms"
  ON public.hs_code_synonyms FOR SELECT
  USING (true);

-- Admin write access
CREATE POLICY "Admins can manage hs_code_synonyms"
  ON public.hs_code_synonyms FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Indexes for fast lookup
CREATE INDEX idx_hs_code_synonyms_code ON public.hs_code_synonyms(hs_code);
CREATE INDEX idx_hs_code_synonyms_fr ON public.hs_code_synonyms USING GIN(to_tsvector('french', COALESCE(synonym_fr, '')));
CREATE INDEX idx_hs_code_synonyms_ar ON public.hs_code_synonyms USING GIN(to_tsvector('simple', COALESCE(synonym_ar, '')));

-- ============================================================================
-- 2. Table classification_history - Historique des classifications IA
-- ============================================================================
CREATE TABLE public.classification_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question TEXT NOT NULL,
  product_description TEXT,
  suggested_code TEXT,
  confirmed_code TEXT,
  was_correct BOOLEAN,
  feedback_text TEXT,
  session_id TEXT,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.classification_history ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own history
CREATE POLICY "Users can view their own classification history"
  ON public.classification_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create classification history"
  ON public.classification_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own classification history"
  ON public.classification_history FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can see all
CREATE POLICY "Admins can view all classification history"
  ON public.classification_history FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX idx_classification_history_code ON public.classification_history(suggested_code);
CREATE INDEX idx_classification_history_user ON public.classification_history(user_id);
CREATE INDEX idx_classification_history_created ON public.classification_history(created_at DESC);

-- ============================================================================
-- 3. Add embedding column to country_tariffs
-- ============================================================================
ALTER TABLE public.country_tariffs
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE;

-- Index for vector search
CREATE INDEX IF NOT EXISTS idx_country_tariffs_embedding 
  ON public.country_tariffs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Trigger to queue embedding generation for country_tariffs
CREATE OR REPLACE FUNCTION public.queue_country_tariff_embedding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.embedding_queue (table_name, record_id, text_content, status)
  VALUES (
    'country_tariffs',
    NEW.id,
    COALESCE(NEW.description_local, '') || ' ' || COALESCE(NEW.national_code, '') || ' ' || COALESCE(NEW.hs_code_6, ''),
    'pending'
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER queue_country_tariff_embedding_trigger
  AFTER INSERT OR UPDATE OF description_local ON public.country_tariffs
  FOR EACH ROW
  WHEN (NEW.description_local IS NOT NULL AND NEW.description_local != '')
  EXECUTE FUNCTION public.queue_country_tariff_embedding();

-- ============================================================================
-- 4. RPC for synonym search (used by query expansion)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_synonyms(search_text TEXT, result_limit INT DEFAULT 10)
RETURNS TABLE(hs_code TEXT, synonym_fr TEXT, synonym_ar TEXT, synonym_en TEXT, category TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.hs_code, s.synonym_fr, s.synonym_ar, s.synonym_en, s.category
  FROM public.hs_code_synonyms s
  WHERE 
    s.synonym_fr ILIKE '%' || search_text || '%'
    OR s.synonym_ar ILIKE '%' || search_text || '%'
    OR s.synonym_en ILIKE '%' || search_text || '%'
    OR to_tsvector('french', COALESCE(s.synonym_fr, '')) @@ plainto_tsquery('french', search_text)
  LIMIT result_limit;
END;
$$;

-- ============================================================================
-- 5. RPC for country_tariffs semantic search
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_country_tariffs_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  country text DEFAULT 'MA'
)
RETURNS TABLE(
  id uuid,
  national_code text,
  hs_code_6 text,
  description_local text,
  duty_rate numeric,
  vat_rate numeric,
  is_prohibited boolean,
  is_restricted boolean,
  similarity float
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ct.id,
    ct.national_code,
    ct.hs_code_6,
    ct.description_local,
    ct.duty_rate,
    ct.vat_rate,
    ct.is_prohibited,
    ct.is_restricted,
    1 - (ct.embedding <=> query_embedding) AS similarity
  FROM public.country_tariffs ct
  WHERE 
    ct.is_active = true
    AND ct.country_code = country
    AND ct.embedding IS NOT NULL
    AND 1 - (ct.embedding <=> query_embedding) > match_threshold
  ORDER BY ct.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
