
-- ============================================================
-- MODULE CONSULTATION — Tables & Functions
-- ============================================================

-- 1. CONSULTATIONS TABLE
CREATE TABLE IF NOT EXISTS public.consultations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference VARCHAR(20) NOT NULL UNIQUE,
  user_id UUID REFERENCES public.phone_users(id) ON DELETE SET NULL,
  consultation_type VARCHAR(20) NOT NULL DEFAULT 'import',
  inputs JSONB NOT NULL DEFAULT '{}',
  report JSONB DEFAULT NULL,
  ai_response TEXT,
  confidence VARCHAR(10) DEFAULT 'medium',
  processing_time_ms INTEGER,
  status VARCHAR(20) DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultations_user ON public.consultations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_type ON public.consultations(consultation_type);
CREATE INDEX IF NOT EXISTS idx_consultations_ref ON public.consultations(reference);

ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access consultations"
  ON public.consultations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can view own consultations"
  ON public.consultations FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM public.phone_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can create consultations"
  ON public.consultations FOR INSERT TO authenticated
  WITH CHECK (user_id IN (SELECT id FROM public.phone_users WHERE auth_user_id = auth.uid()));

-- 2. ENRICH controlled_products
ALTER TABLE public.controlled_products
  ADD COLUMN IF NOT EXISTS procedure_steps JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS estimated_delay VARCHAR(50),
  ADD COLUMN IF NOT EXISTS estimated_cost VARCHAR(100),
  ADD COLUMN IF NOT EXISTS required_before VARCHAR(30) DEFAULT 'customs',
  ADD COLUMN IF NOT EXISTS documents_needed JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS portal_url TEXT,
  ADD COLUMN IF NOT EXISTS legal_basis TEXT;

-- 3. MRE RULES TABLE
CREATE TABLE IF NOT EXISTS public.mre_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_type VARCHAR(50) NOT NULL,
  condition_key VARCHAR(100) NOT NULL,
  condition_value TEXT NOT NULL,
  description_fr TEXT,
  legal_reference TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mre_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read mre_rules"
  ON public.mre_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages mre_rules"
  ON public.mre_rules FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. TIC RATES TABLE
CREATE TABLE IF NOT EXISTS public.tic_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hs_code_pattern VARCHAR(20) NOT NULL,
  tic_type VARCHAR(20) NOT NULL DEFAULT 'ad_valorem',
  tic_rate DECIMAL(10,4),
  tic_amount DECIMAL(15,2),
  tic_unit VARCHAR(20),
  description_fr TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tic_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tic_rates"
  ON public.tic_rates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages tic_rates"
  ON public.tic_rates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. IMPORT DOCUMENTS TABLE
CREATE TABLE IF NOT EXISTS public.import_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_name TEXT NOT NULL,
  document_name_fr TEXT NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'mandatory',
  applies_to VARCHAR(30) DEFAULT 'all',
  description_fr TEXT,
  when_required TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

ALTER TABLE public.import_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read import_documents"
  ON public.import_documents FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages import_documents"
  ON public.import_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. GENERATE CONSULTATION REFERENCE
CREATE OR REPLACE FUNCTION public.generate_consultation_ref(type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prefix TEXT;
  seq INTEGER;
BEGIN
  prefix := CASE type
    WHEN 'import' THEN 'CONS'
    WHEN 'mre' THEN 'MRE'
    WHEN 'conformity' THEN 'CONF'
    WHEN 'investor' THEN 'INV'
    ELSE 'CONS'
  END;
  SELECT COUNT(*) + 1 INTO seq FROM public.consultations
    WHERE consultation_type = type AND created_at >= date_trunc('year', now());
  RETURN prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(seq::TEXT, 5, '0');
END;
$$;

-- 7. Updated_at trigger for consultations
CREATE TRIGGER update_consultations_updated_at
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
