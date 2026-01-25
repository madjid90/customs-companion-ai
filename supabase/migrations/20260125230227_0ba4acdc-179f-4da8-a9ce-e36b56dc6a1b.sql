-- ============================================
-- DOUANEAI DATABASE SCHEMA
-- Complete database structure for customs AI
-- ============================================

-- 1. COUNTRIES TABLE
CREATE TABLE public.countries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(3) NOT NULL UNIQUE,
  code_alpha3 VARCHAR(3),
  name_fr TEXT NOT NULL,
  name_en TEXT,
  currency_code VARCHAR(3) DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. HS CODES TABLE
CREATE TABLE public.hs_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  code_clean VARCHAR(20) NOT NULL,
  description_fr TEXT NOT NULL,
  description_en TEXT,
  chapter_number INTEGER,
  section_number INTEGER,
  level VARCHAR(20) DEFAULT 'subheading',
  parent_code VARCHAR(20),
  legal_notes TEXT,
  explanatory_notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. COUNTRY TARIFFS TABLE
CREATE TABLE public.country_tariffs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL REFERENCES public.countries(code),
  hs_code_6 VARCHAR(6) NOT NULL,
  national_code VARCHAR(20) NOT NULL,
  description_local TEXT,
  duty_rate DECIMAL(10,2) DEFAULT 0,
  vat_rate DECIMAL(10,2) DEFAULT 20,
  other_taxes JSONB DEFAULT '{}',
  is_prohibited BOOLEAN DEFAULT false,
  is_restricted BOOLEAN DEFAULT false,
  effective_date DATE,
  expiry_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(country_code, national_code)
);

-- 4. CONTROLLED PRODUCTS TABLE
CREATE TABLE public.controlled_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL REFERENCES public.countries(code),
  hs_code VARCHAR(20) NOT NULL,
  control_type VARCHAR(50) NOT NULL,
  control_authority TEXT,
  required_norm TEXT,
  required_documents JSONB DEFAULT '[]',
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. TRADE AGREEMENTS TABLE
CREATE TABLE public.trade_agreements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_en TEXT,
  parties JSONB NOT NULL DEFAULT '[]',
  effective_date DATE,
  proof_required TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 6. ORIGIN RULES TABLE
CREATE TABLE public.origin_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_code VARCHAR(20) NOT NULL REFERENCES public.trade_agreements(code),
  agreement_name TEXT,
  hs_code VARCHAR(20) NOT NULL,
  rule_text TEXT,
  rule_type VARCHAR(50),
  minimum_value_added DECIMAL(5,2),
  proof_required TEXT,
  source_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(agreement_code, hs_code)
);

-- 7. PDF DOCUMENTS TABLE
CREATE TABLE public.pdf_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  category VARCHAR(50) NOT NULL,
  country_code VARCHAR(3) REFERENCES public.countries(code),
  reference TEXT,
  publication_date DATE,
  tags JSONB DEFAULT '[]',
  keywords TEXT,
  related_hs_codes JSONB DEFAULT '[]',
  is_verified BOOLEAN DEFAULT false,
  verified_by TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 8. PDF EXTRACTIONS TABLE
CREATE TABLE public.pdf_extractions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pdf_id UUID NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  extracted_text TEXT,
  summary TEXT,
  key_points JSONB DEFAULT '[]',
  mentioned_hs_codes JSONB DEFAULT '[]',
  detected_tariff_changes JSONB DEFAULT '[]',
  extraction_model TEXT DEFAULT 'claude-sonnet-4-20250514',
  extraction_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 9. KNOWLEDGE DOCUMENTS TABLE
CREATE TABLE public.knowledge_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50),
  country_code VARCHAR(3) REFERENCES public.countries(code),
  source_url TEXT,
  tags JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 10. CLASSIFICATION OPINIONS TABLE
CREATE TABLE public.classification_opinions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL REFERENCES public.countries(code),
  reference_number TEXT,
  product_description TEXT NOT NULL,
  assigned_hs_code VARCHAR(20),
  justification TEXT,
  issued_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 11. VEILLE DOCUMENTS TABLE
CREATE TABLE public.veille_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  source_url TEXT,
  source_name TEXT,
  category VARCHAR(50),
  country_code VARCHAR(3) REFERENCES public.countries(code),
  importance VARCHAR(20) DEFAULT 'moyenne',
  mentioned_hs_codes JSONB DEFAULT '[]',
  detected_tariff_changes JSONB DEFAULT '[]',
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  collected_by VARCHAR(50) DEFAULT 'automatic',
  search_keyword TEXT,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 12. VEILLE CONFIG TABLE
CREATE TABLE public.veille_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  is_enabled BOOLEAN DEFAULT false,
  frequency_hours INTEGER DEFAULT 24,
  mode VARCHAR(20) DEFAULT 'validation',
  notification_email TEXT,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 13. VEILLE KEYWORDS TABLE
CREATE TABLE public.veille_keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  category VARCHAR(50),
  country_code VARCHAR(3) REFERENCES public.countries(code),
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_searched_at TIMESTAMP WITH TIME ZONE,
  total_searches INTEGER DEFAULT 0,
  total_results INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 14. VEILLE SITES TABLE
CREATE TABLE public.veille_sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  country_code VARCHAR(3) REFERENCES public.countries(code),
  is_active BOOLEAN DEFAULT true,
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 15. VEILLE LOGS TABLE
CREATE TABLE public.veille_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  cycle_ended_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'running',
  keywords_searched INTEGER DEFAULT 0,
  sites_scraped INTEGER DEFAULT 0,
  documents_found INTEGER DEFAULT 0,
  documents_new INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 16. CONVERSATIONS TABLE
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT,
  question TEXT NOT NULL,
  response TEXT,
  detected_intent VARCHAR(50),
  detected_hs_codes JSONB DEFAULT '[]',
  context_used JSONB DEFAULT '{}',
  pdfs_used JSONB DEFAULT '[]',
  sources_cited JSONB DEFAULT '[]',
  confidence_level VARCHAR(20),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback_text TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 17. ALERTS TABLE
CREATE TABLE public.alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) DEFAULT 'info',
  country_code VARCHAR(3) REFERENCES public.countries(code),
  related_hs_codes JSONB DEFAULT '[]',
  title TEXT NOT NULL,
  message TEXT,
  related_document_id UUID REFERENCES public.pdf_documents(id),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 18. STATISTICS TABLE
CREATE TABLE public.statistics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  stat_type VARCHAR(50) NOT NULL,
  stat_value DECIMAL(15,2),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(stat_date, stat_type)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_hs_codes_code ON public.hs_codes(code);
CREATE INDEX idx_hs_codes_code_clean ON public.hs_codes(code_clean);
CREATE INDEX idx_hs_codes_chapter ON public.hs_codes(chapter_number);
CREATE INDEX idx_hs_codes_description_fr ON public.hs_codes USING GIN (to_tsvector('french', description_fr));

CREATE INDEX idx_country_tariffs_country ON public.country_tariffs(country_code);
CREATE INDEX idx_country_tariffs_hs_code ON public.country_tariffs(hs_code_6);
CREATE INDEX idx_country_tariffs_national ON public.country_tariffs(national_code);

CREATE INDEX idx_controlled_products_country ON public.controlled_products(country_code);
CREATE INDEX idx_controlled_products_hs_code ON public.controlled_products(hs_code);

CREATE INDEX idx_pdf_documents_category ON public.pdf_documents(category);
CREATE INDEX idx_pdf_documents_country ON public.pdf_documents(country_code);
CREATE INDEX idx_pdf_documents_tags ON public.pdf_documents USING GIN (tags);

CREATE INDEX idx_veille_documents_verified ON public.veille_documents(is_verified);
CREATE INDEX idx_veille_documents_country ON public.veille_documents(country_code);

CREATE INDEX idx_conversations_created ON public.conversations(created_at);
CREATE INDEX idx_conversations_rating ON public.conversations(rating);

CREATE INDEX idx_alerts_read ON public.alerts(is_read);
CREATE INDEX idx_alerts_type ON public.alerts(alert_type);

-- ============================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hs_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.origin_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veille_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veille_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veille_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veille_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veille_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statistics ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PUBLIC READ POLICIES (for reference data)
-- ============================================

-- Countries - public read
CREATE POLICY "Countries are publicly readable" ON public.countries
  FOR SELECT USING (true);

-- HS Codes - public read
CREATE POLICY "HS Codes are publicly readable" ON public.hs_codes
  FOR SELECT USING (is_active = true);

-- Country Tariffs - public read
CREATE POLICY "Country Tariffs are publicly readable" ON public.country_tariffs
  FOR SELECT USING (is_active = true);

-- Controlled Products - public read
CREATE POLICY "Controlled Products are publicly readable" ON public.controlled_products
  FOR SELECT USING (is_active = true);

-- Trade Agreements - public read
CREATE POLICY "Trade Agreements are publicly readable" ON public.trade_agreements
  FOR SELECT USING (is_active = true);

-- Origin Rules - public read
CREATE POLICY "Origin Rules are publicly readable" ON public.origin_rules
  FOR SELECT USING (is_active = true);

-- PDF Documents - public read (metadata only)
CREATE POLICY "PDF Documents metadata are publicly readable" ON public.pdf_documents
  FOR SELECT USING (is_active = true);

-- Knowledge Documents - public read
CREATE POLICY "Knowledge Documents are publicly readable" ON public.knowledge_documents
  FOR SELECT USING (is_active = true);

-- Conversations - public insert (anyone can start a conversation)
CREATE POLICY "Anyone can create conversations" ON public.conversations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can read conversations" ON public.conversations
  FOR SELECT USING (true);

CREATE POLICY "Anyone can update conversations" ON public.conversations
  FOR UPDATE USING (true);

-- ============================================
-- SERVICE ROLE POLICIES (for admin operations via edge functions)
-- ============================================

-- Service role can do everything on all tables
-- These policies allow the service role key to perform all operations

CREATE POLICY "Service role can manage countries" ON public.countries
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage hs_codes" ON public.hs_codes
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage country_tariffs" ON public.country_tariffs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage controlled_products" ON public.controlled_products
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage trade_agreements" ON public.trade_agreements
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage origin_rules" ON public.origin_rules
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage pdf_documents" ON public.pdf_documents
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage pdf_extractions" ON public.pdf_extractions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage knowledge_documents" ON public.knowledge_documents
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage classification_opinions" ON public.classification_opinions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage veille_documents" ON public.veille_documents
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage veille_config" ON public.veille_config
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage veille_keywords" ON public.veille_keywords
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage veille_sites" ON public.veille_sites
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage veille_logs" ON public.veille_logs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage alerts" ON public.alerts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage statistics" ON public.statistics
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- TRIGGER FOR UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_countries_updated_at BEFORE UPDATE ON public.countries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_hs_codes_updated_at BEFORE UPDATE ON public.hs_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_country_tariffs_updated_at BEFORE UPDATE ON public.country_tariffs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_controlled_products_updated_at BEFORE UPDATE ON public.controlled_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_trade_agreements_updated_at BEFORE UPDATE ON public.trade_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_origin_rules_updated_at BEFORE UPDATE ON public.origin_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pdf_documents_updated_at BEFORE UPDATE ON public.pdf_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_knowledge_documents_updated_at BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_veille_config_updated_at BEFORE UPDATE ON public.veille_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- STORAGE BUCKET FOR PDF DOCUMENTS
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('pdf-documents', 'pdf-documents', true);

-- Storage policies
CREATE POLICY "PDF documents are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'pdf-documents');

CREATE POLICY "Service role can upload PDFs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'pdf-documents');

CREATE POLICY "Service role can update PDFs"
ON storage.objects FOR UPDATE
USING (bucket_id = 'pdf-documents');

CREATE POLICY "Service role can delete PDFs"
ON storage.objects FOR DELETE
USING (bucket_id = 'pdf-documents');