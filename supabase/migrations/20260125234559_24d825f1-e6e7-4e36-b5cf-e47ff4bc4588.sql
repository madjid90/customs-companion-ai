-- ============================================================
-- 🔧 EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 🌍 COUNTRIES - Colonnes supplémentaires
-- ============================================================
ALTER TABLE countries ADD COLUMN IF NOT EXISTS name_ar VARCHAR(100);
ALTER TABLE countries ADD COLUMN IF NOT EXISTS flag_emoji VARCHAR(10);

-- ============================================================
-- 📦 HS_CODES - Colonnes supplémentaires
-- ============================================================
ALTER TABLE hs_codes ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE hs_codes ADD COLUMN IF NOT EXISTS section_title_fr TEXT;
ALTER TABLE hs_codes ADD COLUMN IF NOT EXISTS chapter_title_fr TEXT;
ALTER TABLE hs_codes ADD COLUMN IF NOT EXISTS hs_version VARCHAR(4) DEFAULT '2022';

-- Index pour recherche full-text
CREATE INDEX IF NOT EXISTS idx_hs_description_fr ON hs_codes USING GIN(to_tsvector('french', description_fr));
CREATE INDEX IF NOT EXISTS idx_hs_code_clean ON hs_codes(code_clean);

-- ============================================================
-- 💰 COUNTRY_TARIFFS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE country_tariffs ADD COLUMN IF NOT EXISTS unit_code VARCHAR(10);
ALTER TABLE country_tariffs ADD COLUMN IF NOT EXISTS unit_description VARCHAR(50);
ALTER TABLE country_tariffs ADD COLUMN IF NOT EXISTS requires_license BOOLEAN DEFAULT false;
ALTER TABLE country_tariffs ADD COLUMN IF NOT EXISTS restriction_notes TEXT;
ALTER TABLE country_tariffs ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE country_tariffs ADD COLUMN IF NOT EXISTS source_url TEXT;

-- ============================================================
-- ⚠️ CONTROLLED_PRODUCTS - Colonnes supplémentaires  
-- ============================================================
ALTER TABLE controlled_products ADD COLUMN IF NOT EXISTS control_stage VARCHAR(50);
ALTER TABLE controlled_products ADD COLUMN IF NOT EXISTS authority_website TEXT;
ALTER TABLE controlled_products ADD COLUMN IF NOT EXISTS standard_reference TEXT;
ALTER TABLE controlled_products ADD COLUMN IF NOT EXISTS procedure_description TEXT;
ALTER TABLE controlled_products ADD COLUMN IF NOT EXISTS effective_date DATE;
ALTER TABLE controlled_products ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Rename required_norm to standard_required for consistency
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'controlled_products' AND column_name = 'required_norm') THEN
    ALTER TABLE controlled_products RENAME COLUMN required_norm TO standard_required;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- ============================================================
-- 🤝 TRADE_AGREEMENTS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE trade_agreements ADD COLUMN IF NOT EXISTS agreement_type VARCHAR(50);
ALTER TABLE trade_agreements ADD COLUMN IF NOT EXISTS signature_date DATE;
ALTER TABLE trade_agreements ADD COLUMN IF NOT EXISTS legal_text_url TEXT;
ALTER TABLE trade_agreements ADD COLUMN IF NOT EXISTS summary TEXT;

-- Rename effective_date to entry_into_force for consistency
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trade_agreements' AND column_name = 'effective_date') THEN
    ALTER TABLE trade_agreements RENAME COLUMN effective_date TO entry_into_force;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- ============================================================
-- 🔄 ORIGIN_RULES - Colonnes supplémentaires
-- ============================================================
ALTER TABLE origin_rules ADD COLUMN IF NOT EXISTS hs_code_range_start VARCHAR(12);
ALTER TABLE origin_rules ADD COLUMN IF NOT EXISTS hs_code_range_end VARCHAR(12);
ALTER TABLE origin_rules ADD COLUMN IF NOT EXISTS value_added_percent DECIMAL(5,2);
ALTER TABLE origin_rules ADD COLUMN IF NOT EXISTS cumulation_type VARCHAR(50);
ALTER TABLE origin_rules ADD COLUMN IF NOT EXISTS de_minimis_percent DECIMAL(5,2);
ALTER TABLE origin_rules ADD COLUMN IF NOT EXISTS annex_reference VARCHAR(100);

-- ============================================================
-- 📄 PDF_DOCUMENTS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS subcategory VARCHAR(50);
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS page_count INTEGER;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'fr';
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS effective_date DATE;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) DEFAULT 'application/pdf';

-- Rename file_size to file_size_bytes for consistency
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pdf_documents' AND column_name = 'file_size') THEN
    ALTER TABLE pdf_documents RENAME COLUMN file_size TO file_size_bytes;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- Index
CREATE INDEX IF NOT EXISTS idx_pdf_keywords ON pdf_documents USING GIN(to_tsvector('french', COALESCE(keywords, '')));

-- ============================================================
-- 📝 PDF_EXTRACTIONS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE pdf_extractions ADD COLUMN IF NOT EXISTS extracted_data JSONB;
ALTER TABLE pdf_extractions ADD COLUMN IF NOT EXISTS mentioned_amounts JSONB;
ALTER TABLE pdf_extractions ADD COLUMN IF NOT EXISTS extraction_confidence DECIMAL(3,2);

-- Rename detected_tariff_changes to detected_tariff_changes for consistency (already exists)
-- Add extracted_at column
ALTER TABLE pdf_extractions ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- 📚 KNOWLEDGE_DOCUMENTS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS subcategory VARCHAR(50);
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS reference VARCHAR(100);
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_name VARCHAR(100);
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'fr';
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS related_hs_codes JSONB;

-- Index
CREATE INDEX IF NOT EXISTS idx_knowledge_content ON knowledge_documents USING GIN(to_tsvector('french', content));

-- ============================================================
-- ⚖️ CLASSIFICATION_OPINIONS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS hs_version VARCHAR(4);
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS product_characteristics TEXT;
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS product_images JSONB;
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS classification_reasoning TEXT;
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS adoption_date DATE;
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS effective_date DATE;
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'fr';
ALTER TABLE classification_opinions ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Rename reference_number to reference
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'classification_opinions' AND column_name = 'reference_number') THEN
    ALTER TABLE classification_opinions RENAME COLUMN reference_number TO reference;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- Rename assigned_hs_code to hs_code
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'classification_opinions' AND column_name = 'assigned_hs_code') THEN
    ALTER TABLE classification_opinions RENAME COLUMN assigned_hs_code TO hs_code;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- ============================================================
-- 🔍 VEILLE_DOCUMENTS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS subcategory VARCHAR(50);
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2);
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS detected_new_controls JSONB;
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS is_processed BOOLEAN DEFAULT false;
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS keywords TEXT;
ALTER TABLE veille_documents ADD COLUMN IF NOT EXISTS tags JSONB;

-- Make source_url NOT NULL if it exists
-- (Already allows null, we won't change this to avoid breaking existing data)

-- Index
CREATE INDEX IF NOT EXISTS idx_veille_processed ON veille_documents(is_processed);
CREATE INDEX IF NOT EXISTS idx_veille_tags ON veille_documents USING GIN(tags);

-- ============================================================
-- 💬 CONVERSATIONS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS detected_country VARCHAR(2);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS detected_keywords JSONB;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS model_used VARCHAR(50);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tokens_used INTEGER;

-- Rename sources_cited to response_sources
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'sources_cited') THEN
    ALTER TABLE conversations RENAME COLUMN sources_cited TO response_sources;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- ============================================================
-- ⚙️ VEILLE_CONFIG - Colonnes supplémentaires
-- ============================================================
ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS auto_insert BOOLEAN DEFAULT false;
ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT true;
ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS notify_on_high_importance BOOLEAN DEFAULT true;
ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS notify_on_tariff_change BOOLEAN DEFAULT true;
ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS confidence_threshold DECIMAL(3,2) DEFAULT 0.80;
ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS max_results_per_keyword INTEGER DEFAULT 20;

-- Rename is_enabled to is_active
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'veille_config' AND column_name = 'is_enabled') THEN
    ALTER TABLE veille_config RENAME COLUMN is_enabled TO is_active;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- ============================================================
-- 🌐 VEILLE_SITES - Colonnes supplémentaires
-- ============================================================
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS site_type VARCHAR(50);
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS scrape_type VARCHAR(50) DEFAULT 'page';
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS categories JSONB;
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS scrape_selector TEXT;
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS scrape_frequency_hours INTEGER DEFAULT 24;
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS last_scrape_status VARCHAR(20);
ALTER TABLE veille_sites ADD COLUMN IF NOT EXISTS total_documents_found INTEGER DEFAULT 0;

-- ============================================================
-- 📊 VEILLE_LOGS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE veille_logs ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE veille_logs ADD COLUMN IF NOT EXISTS documents_inserted INTEGER DEFAULT 0;
ALTER TABLE veille_logs ADD COLUMN IF NOT EXISTS tariffs_updated INTEGER DEFAULT 0;
ALTER TABLE veille_logs ADD COLUMN IF NOT EXISTS controls_added INTEGER DEFAULT 0;
ALTER TABLE veille_logs ADD COLUMN IF NOT EXISTS warnings JSONB;

-- ============================================================
-- 🔔 ALERTS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS action_required TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_type VARCHAR(50);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS is_actioned BOOLEAN DEFAULT false;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS actioned_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS actioned_by VARCHAR(100);

-- ============================================================
-- 📈 STATISTICS - Colonnes supplémentaires
-- ============================================================
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS total_conversations INTEGER DEFAULT 0;
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS total_questions INTEGER DEFAULT 0;
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2);
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS questions_by_intent JSONB;
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS questions_by_country JSONB;
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS avg_response_time_ms INTEGER;

-- ============================================================
-- 🔧 FONCTIONS UTILES
-- ============================================================

-- Fonction: Recherche de codes SH
CREATE OR REPLACE FUNCTION search_hs_codes(
    search_term TEXT,
    limit_count INTEGER DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    code VARCHAR,
    description_fr TEXT,
    chapter_number INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.id,
        h.code,
        h.description_fr,
        h.chapter_number
    FROM hs_codes h
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
$$;

-- Fonction: Obtenir tarif complet
CREATE OR REPLACE FUNCTION get_tariff_details(
    p_country_code VARCHAR,
    p_hs_code VARCHAR
)
RETURNS TABLE (
    hs_code VARCHAR,
    national_code VARCHAR,
    description TEXT,
    duty_rate DECIMAL,
    vat_rate DECIMAL,
    is_controlled BOOLEAN,
    control_type VARCHAR,
    control_authority VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.hs_code_6,
        t.national_code,
        COALESCE(t.description_local, h.description_fr),
        t.duty_rate,
        t.vat_rate,
        EXISTS(
            SELECT 1 FROM controlled_products cp 
            WHERE cp.hs_code LIKE t.hs_code_6 || '%' 
            AND cp.country_code = p_country_code
            AND cp.is_active = true
        ),
        (
            SELECT cp.control_type FROM controlled_products cp 
            WHERE cp.hs_code LIKE t.hs_code_6 || '%' 
            AND cp.country_code = p_country_code 
            AND cp.is_active = true
            LIMIT 1
        ),
        (
            SELECT cp.control_authority FROM controlled_products cp 
            WHERE cp.hs_code LIKE t.hs_code_6 || '%' 
            AND cp.country_code = p_country_code 
            AND cp.is_active = true
            LIMIT 1
        )
    FROM country_tariffs t
    LEFT JOIN hs_codes h ON h.code_clean = t.hs_code_6
    WHERE t.country_code = p_country_code
    AND t.is_active = true
    AND (
        t.hs_code_6 = p_hs_code
        OR t.hs_code_6 LIKE p_hs_code || '%'
        OR t.national_code LIKE p_hs_code || '%'
    )
    ORDER BY t.national_code
    LIMIT 20;
END;
$$;

-- Fonction: Statistiques dashboard
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS TABLE (
    hs_codes_count BIGINT,
    tariffs_count BIGINT,
    documents_count BIGINT,
    pdfs_count BIGINT,
    conversations_count BIGINT,
    veille_pending_count BIGINT,
    alerts_unread_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM hs_codes WHERE is_active = true),
        (SELECT COUNT(*) FROM country_tariffs WHERE is_active = true),
        (SELECT COUNT(*) FROM knowledge_documents WHERE is_active = true),
        (SELECT COUNT(*) FROM pdf_documents WHERE is_active = true),
        (SELECT COUNT(*) FROM conversations),
        (SELECT COUNT(*) FROM veille_documents WHERE is_verified = false),
        (SELECT COUNT(*) FROM alerts WHERE is_read = false);
END;
$$;