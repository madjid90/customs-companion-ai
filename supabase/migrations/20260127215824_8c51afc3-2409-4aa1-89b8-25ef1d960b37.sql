-- ============================================
-- TABLE POUR RATE LIMITING DISTRIBUÉ
-- ============================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  client_id TEXT PRIMARY KEY,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE DEFAULT now(),
  blocked_until TIMESTAMP WITH TIME ZONE
);

-- Index pour nettoyer les entrées expirées
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON public.rate_limits(blocked_until);

-- RLS
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage rate_limits" ON public.rate_limits
  FOR ALL USING (true) WITH CHECK (true);

-- Fonction de nettoyage (à appeler périodiquement)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.rate_limits 
  WHERE window_start < now() - INTERVAL '1 hour'
  AND (blocked_until IS NULL OR blocked_until < now());
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================
-- INDEX COMPOSITES POUR PERFORMANCE
-- ============================================

-- Index pour recherche tarifs par pays + code
CREATE INDEX IF NOT EXISTS idx_tariffs_country_hs6_active 
ON public.country_tariffs(country_code, hs_code_6) 
WHERE is_active = true;

-- Index pour recherche avec préfixe (héritage codes)
CREATE INDEX IF NOT EXISTS idx_tariffs_country_national_pattern
ON public.country_tariffs(country_code, national_code text_pattern_ops)
WHERE is_active = true;

-- Index pour produits contrôlés
CREATE INDEX IF NOT EXISTS idx_controlled_country_hs_pattern
ON public.controlled_products(country_code, hs_code text_pattern_ops)
WHERE is_active = true;

-- Index full-text sur extractions PDF
CREATE INDEX IF NOT EXISTS idx_pdf_extractions_text_fts
ON public.pdf_extractions USING GIN (to_tsvector('french', COALESCE(extracted_text, '')));

-- Index pour conversations par session
CREATE INDEX IF NOT EXISTS idx_conversations_session_created
ON public.conversations(session_id, created_at DESC);

-- Rafraîchir les statistiques
ANALYZE public.country_tariffs;
ANALYZE public.controlled_products;
ANALYZE public.pdf_extractions;
ANALYZE public.conversations;