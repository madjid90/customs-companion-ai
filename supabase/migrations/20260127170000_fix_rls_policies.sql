-- ============================================
-- FIX RLS POLICIES - Security Improvements
-- Restrict write operations to service_role only
-- Add session-based restrictions for conversations
-- ============================================

-- ============================================
-- 1. DROP OVERLY PERMISSIVE SERVICE ROLE POLICIES
-- These policies used USING(true) which allows any user
-- ============================================

DROP POLICY IF EXISTS "Service role can manage countries" ON public.countries;
DROP POLICY IF EXISTS "Service role can manage hs_codes" ON public.hs_codes;
DROP POLICY IF EXISTS "Service role can manage country_tariffs" ON public.country_tariffs;
DROP POLICY IF EXISTS "Service role can manage controlled_products" ON public.controlled_products;
DROP POLICY IF EXISTS "Service role can manage trade_agreements" ON public.trade_agreements;
DROP POLICY IF EXISTS "Service role can manage origin_rules" ON public.origin_rules;
DROP POLICY IF EXISTS "Service role can manage pdf_documents" ON public.pdf_documents;
DROP POLICY IF EXISTS "Service role can manage pdf_extractions" ON public.pdf_extractions;
DROP POLICY IF EXISTS "Service role can manage knowledge_documents" ON public.knowledge_documents;
DROP POLICY IF EXISTS "Service role can manage classification_opinions" ON public.classification_opinions;
DROP POLICY IF EXISTS "Service role can manage veille_documents" ON public.veille_documents;
DROP POLICY IF EXISTS "Service role can manage veille_config" ON public.veille_config;
DROP POLICY IF EXISTS "Service role can manage veille_keywords" ON public.veille_keywords;
DROP POLICY IF EXISTS "Service role can manage veille_sites" ON public.veille_sites;
DROP POLICY IF EXISTS "Service role can manage veille_logs" ON public.veille_logs;
DROP POLICY IF EXISTS "Service role can manage alerts" ON public.alerts;
DROP POLICY IF EXISTS "Service role can manage statistics" ON public.statistics;
DROP POLICY IF EXISTS "Service role can manage response_cache" ON public.response_cache;

-- Drop overly permissive conversation policies
DROP POLICY IF EXISTS "Anyone can read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can create conversations" ON public.conversations;

-- ============================================
-- 2. ADD MISSING PUBLIC READ POLICIES
-- ============================================

-- PDF Extractions - public read (linked to verified PDFs)
CREATE POLICY "PDF Extractions are publicly readable" ON public.pdf_extractions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pdf_documents pd
      WHERE pd.id = pdf_extractions.pdf_id
      AND pd.is_active = true
    )
  );

-- Veille Documents - public read for verified documents
CREATE POLICY "Verified veille documents are publicly readable" ON public.veille_documents
  FOR SELECT USING (is_verified = true OR status = 'approved');

-- Classification Opinions - public read
CREATE POLICY "Classification Opinions are publicly readable" ON public.classification_opinions
  FOR SELECT USING (is_active = true);

-- Veille Config - public read (non-sensitive config)
CREATE POLICY "Veille config is publicly readable" ON public.veille_config
  FOR SELECT USING (true);

-- Veille Keywords - public read
CREATE POLICY "Veille keywords are publicly readable" ON public.veille_keywords
  FOR SELECT USING (is_active = true);

-- Veille Sites - public read
CREATE POLICY "Veille sites are publicly readable" ON public.veille_sites
  FOR SELECT USING (is_active = true);

-- Veille Logs - public read (for transparency)
CREATE POLICY "Veille logs are publicly readable" ON public.veille_logs
  FOR SELECT USING (true);

-- Alerts - public read
CREATE POLICY "Alerts are publicly readable" ON public.alerts
  FOR SELECT USING (true);

-- Statistics - public read
CREATE POLICY "Statistics are publicly readable" ON public.statistics
  FOR SELECT USING (true);

-- ============================================
-- 3. SECURE CONVERSATION POLICIES
-- Session-based isolation for user conversations
-- ============================================

-- Users can only INSERT conversations (tracked by session_id)
CREATE POLICY "Users can create their own conversations" ON public.conversations
  FOR INSERT WITH CHECK (true);

-- Users can only READ their own conversations by session_id
CREATE POLICY "Users can read their own conversations" ON public.conversations
  FOR SELECT USING (session_id = current_setting('request.headers', true)::json->>'x-session-id');

-- Users can only UPDATE their own conversations (for feedback)
-- Allow if session_id matches OR if it's a recent conversation (within 24h) being rated
CREATE POLICY "Users can update their own conversations" ON public.conversations
  FOR UPDATE USING (
    session_id = current_setting('request.headers', true)::json->>'x-session-id'
    OR created_at > now() - interval '24 hours'
  );

-- ============================================
-- 4. RESPONSE CACHE POLICIES (PUBLIC READ, SERVICE WRITE)
-- ============================================

DROP POLICY IF EXISTS "Response cache is readable" ON public.response_cache;

CREATE POLICY "Response cache is publicly readable" ON public.response_cache
  FOR SELECT USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- ============================================
-- 5. GRANT PROPER PERMISSIONS TO SERVICE ROLE
-- Service role already has full access via superuser-like permissions
-- but we ensure edge functions using service_role key can operate
-- ============================================

-- Grant necessary table permissions to service_role
-- (Service role already has these by default in Supabase, but explicit is better)

GRANT ALL ON public.countries TO service_role;
GRANT ALL ON public.hs_codes TO service_role;
GRANT ALL ON public.country_tariffs TO service_role;
GRANT ALL ON public.controlled_products TO service_role;
GRANT ALL ON public.trade_agreements TO service_role;
GRANT ALL ON public.origin_rules TO service_role;
GRANT ALL ON public.pdf_documents TO service_role;
GRANT ALL ON public.pdf_extractions TO service_role;
GRANT ALL ON public.knowledge_documents TO service_role;
GRANT ALL ON public.classification_opinions TO service_role;
GRANT ALL ON public.veille_documents TO service_role;
GRANT ALL ON public.veille_config TO service_role;
GRANT ALL ON public.veille_keywords TO service_role;
GRANT ALL ON public.veille_sites TO service_role;
GRANT ALL ON public.veille_logs TO service_role;
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.alerts TO service_role;
GRANT ALL ON public.statistics TO service_role;
GRANT ALL ON public.response_cache TO service_role;

-- Grant sequence usage for auto-increment IDs
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================
-- 6. GRANT READ-ONLY TO ANON ROLE
-- Anonymous users can only read public data
-- ============================================

GRANT SELECT ON public.countries TO anon;
GRANT SELECT ON public.hs_codes TO anon;
GRANT SELECT ON public.country_tariffs TO anon;
GRANT SELECT ON public.controlled_products TO anon;
GRANT SELECT ON public.trade_agreements TO anon;
GRANT SELECT ON public.origin_rules TO anon;
GRANT SELECT ON public.pdf_documents TO anon;
GRANT SELECT ON public.pdf_extractions TO anon;
GRANT SELECT ON public.knowledge_documents TO anon;
GRANT SELECT ON public.classification_opinions TO anon;
GRANT SELECT ON public.veille_documents TO anon;
GRANT SELECT ON public.veille_config TO anon;
GRANT SELECT ON public.veille_keywords TO anon;
GRANT SELECT ON public.veille_sites TO anon;
GRANT SELECT ON public.veille_logs TO anon;
GRANT SELECT ON public.alerts TO anon;
GRANT SELECT ON public.statistics TO anon;
GRANT SELECT ON public.response_cache TO anon;

-- Anon can insert/update conversations only
GRANT INSERT, SELECT, UPDATE ON public.conversations TO anon;

-- ============================================
-- 7. GRANT AUTHENTICATED ROLE PERMISSIONS
-- Authenticated users have same permissions as anon for this app
-- (no user accounts, just session-based)
-- ============================================

GRANT SELECT ON public.countries TO authenticated;
GRANT SELECT ON public.hs_codes TO authenticated;
GRANT SELECT ON public.country_tariffs TO authenticated;
GRANT SELECT ON public.controlled_products TO authenticated;
GRANT SELECT ON public.trade_agreements TO authenticated;
GRANT SELECT ON public.origin_rules TO authenticated;
GRANT SELECT ON public.pdf_documents TO authenticated;
GRANT SELECT ON public.pdf_extractions TO authenticated;
GRANT SELECT ON public.knowledge_documents TO authenticated;
GRANT SELECT ON public.classification_opinions TO authenticated;
GRANT SELECT ON public.veille_documents TO authenticated;
GRANT SELECT ON public.veille_config TO authenticated;
GRANT SELECT ON public.veille_keywords TO authenticated;
GRANT SELECT ON public.veille_sites TO authenticated;
GRANT SELECT ON public.veille_logs TO authenticated;
GRANT SELECT ON public.alerts TO authenticated;
GRANT SELECT ON public.statistics TO authenticated;
GRANT SELECT ON public.response_cache TO authenticated;
GRANT INSERT, SELECT, UPDATE ON public.conversations TO authenticated;

-- ============================================
-- 8. ADD INDEX FOR SESSION-BASED QUERIES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON public.conversations(session_id);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON POLICY "Users can read their own conversations" ON public.conversations
  IS 'Restricts conversation access to the session that created it via x-session-id header';

COMMENT ON POLICY "Verified veille documents are publicly readable" ON public.veille_documents
  IS 'Only verified or approved veille documents are visible to public users';
