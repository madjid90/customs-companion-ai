-- ============================================================================
-- TABLE: legal_references - Références légales extraites des documents
-- ============================================================================

CREATE TABLE public.legal_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pdf_id UUID NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  reference_type VARCHAR(50) NOT NULL, -- circulaire, loi, décret, arrêté, article, note, convention, bo
  reference_number TEXT NOT NULL, -- Numéro/référence complète
  title TEXT, -- Intitulé si disponible
  reference_date DATE, -- Date du texte référencé
  context VARCHAR(50), -- abroge, modifie, complète, cite, etc.
  country_code VARCHAR(10) DEFAULT 'MA',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour recherche rapide
CREATE INDEX idx_legal_references_pdf_id ON public.legal_references(pdf_id);
CREATE INDEX idx_legal_references_type ON public.legal_references(reference_type);
CREATE INDEX idx_legal_references_number ON public.legal_references USING gin(to_tsvector('french', reference_number));
CREATE INDEX idx_legal_references_country ON public.legal_references(country_code);

-- RLS
ALTER TABLE public.legal_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Legal references are publicly readable"
ON public.legal_references FOR SELECT
USING (is_active = true);

CREATE POLICY "Service role can manage legal_references"
ON public.legal_references FOR ALL
USING (true)
WITH CHECK (true);

-- ============================================================================
-- TABLE: regulatory_dates - Dates importantes extraites des documents
-- ============================================================================

CREATE TABLE public.regulatory_dates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pdf_id UUID NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  date_value DATE NOT NULL,
  date_type VARCHAR(50) NOT NULL, -- publication, application, expiration, limite, référence
  description TEXT,
  country_code VARCHAR(10) DEFAULT 'MA',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour recherche
CREATE INDEX idx_regulatory_dates_pdf_id ON public.regulatory_dates(pdf_id);
CREATE INDEX idx_regulatory_dates_type ON public.regulatory_dates(date_type);
CREATE INDEX idx_regulatory_dates_value ON public.regulatory_dates(date_value);

-- RLS
ALTER TABLE public.regulatory_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Regulatory dates are publicly readable"
ON public.regulatory_dates FOR SELECT
USING (is_active = true);

CREATE POLICY "Service role can manage regulatory_dates"
ON public.regulatory_dates FOR ALL
USING (true)
WITH CHECK (true);

-- ============================================================================
-- TABLE: regulatory_procedures - Procédures extraites des documents
-- ============================================================================

CREATE TABLE public.regulatory_procedures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pdf_id UUID NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  procedure_name TEXT NOT NULL,
  required_documents JSONB DEFAULT '[]'::jsonb,
  deadlines TEXT,
  penalties TEXT,
  authority TEXT,
  country_code VARCHAR(10) DEFAULT 'MA',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index
CREATE INDEX idx_regulatory_procedures_pdf_id ON public.regulatory_procedures(pdf_id);
CREATE INDEX idx_regulatory_procedures_name ON public.regulatory_procedures USING gin(to_tsvector('french', procedure_name));

-- RLS
ALTER TABLE public.regulatory_procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Regulatory procedures are publicly readable"
ON public.regulatory_procedures FOR SELECT
USING (is_active = true);

CREATE POLICY "Service role can manage regulatory_procedures"
ON public.regulatory_procedures FOR ALL
USING (true)
WITH CHECK (true);

-- ============================================================================
-- Ajouter colonnes enrichies à pdf_documents pour recherche rapide
-- ============================================================================

ALTER TABLE public.pdf_documents 
ADD COLUMN IF NOT EXISTS document_reference TEXT,
ADD COLUMN IF NOT EXISTS issuing_authority TEXT,
ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT 'tariff';

-- Index sur les nouveaux champs
CREATE INDEX IF NOT EXISTS idx_pdf_documents_document_type ON public.pdf_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_document_reference ON public.pdf_documents(document_reference);

-- ============================================================================
-- Fonction RPC pour rechercher les références légales
-- ============================================================================

CREATE OR REPLACE FUNCTION search_legal_references(
  search_term TEXT,
  limit_count INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  reference_type VARCHAR,
  reference_number TEXT,
  title TEXT,
  reference_date DATE,
  context VARCHAR,
  pdf_title TEXT,
  pdf_category VARCHAR,
  pdf_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lr.id,
    lr.reference_type,
    lr.reference_number,
    lr.title,
    lr.reference_date,
    lr.context,
    pd.title AS pdf_title,
    pd.category AS pdf_category,
    pd.id AS pdf_id
  FROM legal_references lr
  JOIN pdf_documents pd ON pd.id = lr.pdf_id
  WHERE lr.is_active = true
    AND pd.is_active = true
    AND (
      lr.reference_number ILIKE '%' || search_term || '%'
      OR lr.title ILIKE '%' || search_term || '%'
      OR lr.reference_type ILIKE '%' || search_term || '%'
    )
  ORDER BY lr.reference_date DESC NULLS LAST
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- Fonction RPC pour rechercher les procédures
-- ============================================================================

CREATE OR REPLACE FUNCTION search_regulatory_procedures(
  search_term TEXT,
  limit_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  procedure_name TEXT,
  required_documents JSONB,
  deadlines TEXT,
  penalties TEXT,
  authority TEXT,
  pdf_title TEXT,
  pdf_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rp.id,
    rp.procedure_name,
    rp.required_documents,
    rp.deadlines,
    rp.penalties,
    rp.authority,
    pd.title AS pdf_title,
    pd.id AS pdf_id
  FROM regulatory_procedures rp
  JOIN pdf_documents pd ON pd.id = rp.pdf_id
  WHERE rp.is_active = true
    AND pd.is_active = true
    AND (
      rp.procedure_name ILIKE '%' || search_term || '%'
      OR rp.authority ILIKE '%' || search_term || '%'
    )
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;