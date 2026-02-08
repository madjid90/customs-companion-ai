
-- ============================================================================
-- AUDIT PRODUCTION FIX: Suppress dangerous "Service role can manage" policies
-- ============================================================================

-- 1. DROP all "Service role can manage" policies
DROP POLICY IF EXISTS "Service role can manage alerts" ON public.alerts;
DROP POLICY IF EXISTS "Service role can manage classification_opinions" ON public.classification_opinions;
DROP POLICY IF EXISTS "Service role can manage controlled_products" ON public.controlled_products;
DROP POLICY IF EXISTS "Service role can manage countries" ON public.countries;
DROP POLICY IF EXISTS "Service role can manage country_tariffs" ON public.country_tariffs;
DROP POLICY IF EXISTS "Service role can manage hs_codes" ON public.hs_codes;
DROP POLICY IF EXISTS "Service role can manage hs_evidence" ON public.hs_evidence;
DROP POLICY IF EXISTS "Service role can manage knowledge_documents" ON public.knowledge_documents;
DROP POLICY IF EXISTS "Service role can manage legal_chunks" ON public.legal_chunks;
DROP POLICY IF EXISTS "Service role can manage legal_references" ON public.legal_references;
DROP POLICY IF EXISTS "Service role can manage legal_sources" ON public.legal_sources;
DROP POLICY IF EXISTS "Service role can manage origin_rules" ON public.origin_rules;
DROP POLICY IF EXISTS "Service role can manage pdf_documents" ON public.pdf_documents;
DROP POLICY IF EXISTS "Service role can manage pdf_extraction_runs" ON public.pdf_extraction_runs;
DROP POLICY IF EXISTS "Service role can manage pdf_extractions" ON public.pdf_extractions;
DROP POLICY IF EXISTS "Service role can manage regulatory_dates" ON public.regulatory_dates;
DROP POLICY IF EXISTS "Service role can manage regulatory_procedures" ON public.regulatory_procedures;
DROP POLICY IF EXISTS "Service role can manage statistics" ON public.statistics;
DROP POLICY IF EXISTS "Service role can manage tariff_notes" ON public.tariff_notes;
DROP POLICY IF EXISTS "Service role can manage trade_agreements" ON public.trade_agreements;
DROP POLICY IF EXISTS "Service role can manage veille_config" ON public.veille_config;
DROP POLICY IF EXISTS "Service role can manage veille_documents" ON public.veille_documents;
DROP POLICY IF EXISTS "Service role can manage veille_keywords" ON public.veille_keywords;
DROP POLICY IF EXISTS "Service role can manage veille_logs" ON public.veille_logs;
DROP POLICY IF EXISTS "Service role can manage veille_sites" ON public.veille_sites;
DROP POLICY IF EXISTS "dum_documents_service_write" ON public.dum_documents;
DROP POLICY IF EXISTS "dum_items_service_write" ON public.dum_items;
DROP POLICY IF EXISTS "Service role only for embedding_queue" ON public.embedding_queue;

-- ============================================================================
-- 2. FIX conversations table
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can delete conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update their own conversations" ON public.conversations;

CREATE POLICY "Users read own session conversations"
  ON public.conversations FOR SELECT
  USING (
    session_id = ((current_setting('request.headers'::text, true))::json ->> 'x-session-id')
  );

CREATE POLICY "Users create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users update own session conversations"
  ON public.conversations FOR UPDATE
  USING (
    session_id = ((current_setting('request.headers'::text, true))::json ->> 'x-session-id')
  );

CREATE POLICY "Users delete own session conversations"
  ON public.conversations FOR DELETE
  USING (
    session_id = ((current_setting('request.headers'::text, true))::json ->> 'x-session-id')
  );

-- ============================================================================
-- 3. FIX rate_limits - no public access
-- ============================================================================
DROP POLICY IF EXISTS "rate_limits_public_read" ON public.rate_limits;
DROP POLICY IF EXISTS "rate_limits_public_write" ON public.rate_limits;
DROP POLICY IF EXISTS "rate_limits_public_upsert" ON public.rate_limits;
DROP POLICY IF EXISTS "Service role can manage rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Allow service role to manage rate limits" ON public.rate_limits;

-- ============================================================================
-- 4. FIX response_cache - no public access
-- ============================================================================
DROP POLICY IF EXISTS "response_cache_public_read" ON public.response_cache;
DROP POLICY IF EXISTS "response_cache_public_write" ON public.response_cache;
DROP POLICY IF EXISTS "Service role can manage response_cache" ON public.response_cache;
DROP POLICY IF EXISTS "Allow service role to manage response_cache" ON public.response_cache;
DROP POLICY IF EXISTS "Cache is publicly readable" ON public.response_cache;

-- ============================================================================
-- 5. FIX functions without search_path
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_dashboard_stats();
CREATE FUNCTION public.get_dashboard_stats()
RETURNS TABLE(
  total_conversations bigint,
  today_conversations bigint,
  avg_rating numeric,
  total_documents bigint,
  total_hs_codes bigint,
  total_tariffs bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM conversations) as total_conversations,
    (SELECT count(*) FROM conversations WHERE created_at >= CURRENT_DATE) as today_conversations,
    (SELECT COALESCE(avg(rating), 0) FROM conversations WHERE rating IS NOT NULL) as avg_rating,
    (SELECT count(*) FROM pdf_documents WHERE is_active = true) as total_documents,
    (SELECT count(*) FROM hs_codes WHERE is_active = true) as total_hs_codes,
    (SELECT count(*) FROM country_tariffs WHERE is_active = true) as total_tariffs;
$$;

DROP FUNCTION IF EXISTS public.get_tariff_details(text, text);
CREATE FUNCTION public.get_tariff_details(p_hs_code text, p_country text DEFAULT 'MA')
RETURNS TABLE(
  hs_code_6 text,
  national_code text,
  description_local text,
  duty_rate numeric,
  vat_rate numeric,
  other_taxes jsonb,
  is_prohibited boolean,
  is_restricted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ct.hs_code_6,
    ct.national_code,
    ct.description_local,
    ct.duty_rate,
    ct.vat_rate,
    ct.other_taxes,
    ct.is_prohibited,
    ct.is_restricted
  FROM country_tariffs ct
  WHERE ct.national_code LIKE p_hs_code || '%'
    AND ct.country_code = p_country
    AND ct.is_active = true
  ORDER BY ct.national_code;
$$;

DROP FUNCTION IF EXISTS public.search_hs_codes(text);
CREATE FUNCTION public.search_hs_codes(search_term text)
RETURNS TABLE(
  code text,
  code_clean text,
  description_fr text,
  description_en text,
  level text,
  chapter_number integer,
  section_number integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    h.code,
    h.code_clean,
    h.description_fr,
    h.description_en,
    h.level,
    h.chapter_number,
    h.section_number
  FROM hs_codes h
  WHERE h.is_active = true
    AND (
      h.code_clean LIKE search_term || '%'
      OR h.description_fr ILIKE '%' || search_term || '%'
      OR h.description_en ILIKE '%' || search_term || '%'
    )
  ORDER BY h.code_clean
  LIMIT 50;
$$;
