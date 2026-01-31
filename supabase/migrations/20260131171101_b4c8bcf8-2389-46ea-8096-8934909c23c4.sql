-- ============================================================================
-- TABLE: dum_documents - Déclarations Uniques de Marchandises
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dum_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code VARCHAR(3) NOT NULL DEFAULT 'MA',
  
  -- Source tracking
  source_pdf TEXT,
  source_page_count INT,
  
  -- Header fields extracted
  dum_number TEXT,
  regime_code TEXT,
  bureau_code TEXT,
  bureau_name TEXT,
  dum_date DATE,
  
  -- Parties
  importer_name TEXT,
  importer_id TEXT,
  exporter_name TEXT,
  exporter_country TEXT,
  
  -- Commercial info
  incoterm TEXT,
  currency_code VARCHAR(3),
  invoice_value DECIMAL(15,2),
  freight_value DECIMAL(15,2),
  insurance_value DECIMAL(15,2),
  cif_value DECIMAL(15,2),
  
  -- Full extraction
  extracted_json JSONB,
  
  -- Computed totals
  total_duty DECIMAL(15,2),
  total_vat DECIMAL(15,2),
  total_other_taxes DECIMAL(15,2),
  grand_total DECIMAL(15,2),
  
  -- Status
  is_complete BOOLEAN DEFAULT false,
  missing_rates TEXT[],
  validation_warnings TEXT[],
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS dum_documents_country_idx ON public.dum_documents(country_code);
CREATE INDEX IF NOT EXISTS dum_documents_date_idx ON public.dum_documents(dum_date DESC);
CREATE INDEX IF NOT EXISTS dum_documents_number_idx ON public.dum_documents(dum_number);

-- Enable RLS
ALTER TABLE public.dum_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dum_documents_public_read" ON public.dum_documents FOR SELECT USING (true);
CREATE POLICY "dum_documents_service_write" ON public.dum_documents FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- TABLE: dum_items - Lignes d'articles des DUM
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dum_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dum_id UUID NOT NULL REFERENCES public.dum_documents(id) ON DELETE CASCADE,
  
  -- Line identification
  line_no INT NOT NULL,
  
  -- Product info
  description TEXT,
  quantity DECIMAL(15,4),
  unit TEXT,
  unit_price DECIMAL(15,4),
  value DECIMAL(15,2),
  
  -- Origin & Classification
  origin_country VARCHAR(3),
  hs_code TEXT,
  hs_code_normalized VARCHAR(10),
  
  -- Rates (from DB or extracted)
  duty_rate DECIMAL(5,2),
  duty_rate_source TEXT, -- 'extracted' | 'database' | 'missing'
  vat_rate DECIMAL(5,2) DEFAULT 20,
  other_taxes JSONB, -- {parafiscal: 0.25, tpi: 0.15, ...}
  
  -- Computed amounts
  duty_amount DECIMAL(15,2),
  vat_amount DECIMAL(15,2),
  other_taxes_amount DECIMAL(15,2),
  total_taxes DECIMAL(15,2),
  
  -- Source tracking
  source_page INT,
  source_evidence TEXT,
  extraction_confidence TEXT, -- 'high' | 'medium' | 'low'
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS dum_items_dum_idx ON public.dum_items(dum_id);
CREATE INDEX IF NOT EXISTS dum_items_hs_idx ON public.dum_items(hs_code_normalized);

-- Enable RLS
ALTER TABLE public.dum_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dum_items_public_read" ON public.dum_items FOR SELECT USING (true);
CREATE POLICY "dum_items_service_write" ON public.dum_items FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Function: Calculate taxes for a DUM item
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_dum_item_taxes(
  p_cif_value DECIMAL,
  p_duty_rate DECIMAL,
  p_vat_rate DECIMAL DEFAULT 20,
  p_other_taxes JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_duty_amount DECIMAL;
  v_vat_base DECIMAL;
  v_vat_amount DECIMAL;
  v_other_total DECIMAL := 0;
  v_other_key TEXT;
  v_other_rate DECIMAL;
BEGIN
  -- DDI = CIF × taux_droit / 100
  v_duty_amount := COALESCE(p_cif_value, 0) * COALESCE(p_duty_rate, 0) / 100;
  
  -- TVA base = CIF + DDI
  v_vat_base := COALESCE(p_cif_value, 0) + v_duty_amount;
  
  -- TVA = base × taux_TVA / 100
  v_vat_amount := v_vat_base * COALESCE(p_vat_rate, 20) / 100;
  
  -- Other taxes (parafiscal, TPI, etc.)
  IF p_other_taxes IS NOT NULL THEN
    FOR v_other_key, v_other_rate IN SELECT * FROM jsonb_each_text(p_other_taxes)
    LOOP
      v_other_total := v_other_total + (COALESCE(p_cif_value, 0) * v_other_rate::decimal / 100);
    END LOOP;
  END IF;
  
  RETURN jsonb_build_object(
    'cif_value', p_cif_value,
    'duty_rate', p_duty_rate,
    'duty_amount', ROUND(v_duty_amount, 2),
    'vat_base', ROUND(v_vat_base, 2),
    'vat_rate', p_vat_rate,
    'vat_amount', ROUND(v_vat_amount, 2),
    'other_taxes_amount', ROUND(v_other_total, 2),
    'total_taxes', ROUND(v_duty_amount + v_vat_amount + v_other_total, 2),
    'grand_total', ROUND(COALESCE(p_cif_value, 0) + v_duty_amount + v_vat_amount + v_other_total, 2)
  );
END;
$$;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_dum_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_dum_documents_timestamp
  BEFORE UPDATE ON public.dum_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dum_documents_updated_at();