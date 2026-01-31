-- =============================================
-- 1) Ajouter colonnes dans country_tariffs
-- =============================================
ALTER TABLE public.country_tariffs
ADD COLUMN IF NOT EXISTS source_pdf TEXT;

ALTER TABLE public.country_tariffs
ADD COLUMN IF NOT EXISTS source_page INT;

ALTER TABLE public.country_tariffs
ADD COLUMN IF NOT EXISTS source_extraction_id BIGINT;

ALTER TABLE public.country_tariffs
ADD COLUMN IF NOT EXISTS source_evidence TEXT;

-- =============================================
-- 2) Table legal_sources
-- =============================================
CREATE TABLE IF NOT EXISTS public.legal_sources (
  id BIGSERIAL PRIMARY KEY,
  country_code TEXT NOT NULL DEFAULT 'MA',
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  title TEXT NULL,
  issuer TEXT NULL,
  source_date DATE NULL,
  source_url TEXT NULL,
  excerpt TEXT NULL,
  full_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country_code, source_type, source_ref)
);

-- Enable RLS
ALTER TABLE public.legal_sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Legal sources are publicly readable"
ON public.legal_sources FOR SELECT
USING (true);

CREATE POLICY "Service role can manage legal_sources"
ON public.legal_sources FOR ALL
USING (true)
WITH CHECK (true);

-- =============================================
-- 3) Table hs_evidence
-- =============================================
CREATE TABLE IF NOT EXISTS public.hs_evidence (
  id BIGSERIAL PRIMARY KEY,
  country_code TEXT NOT NULL DEFAULT 'MA',
  national_code TEXT NOT NULL,
  hs_code_6 TEXT NULL,
  source_id BIGINT NOT NULL REFERENCES public.legal_sources(id) ON DELETE CASCADE,
  page_number INT NULL,
  evidence_text TEXT NOT NULL,
  confidence TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.hs_evidence ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "HS evidence is publicly readable"
ON public.hs_evidence FOR SELECT
USING (true);

CREATE POLICY "Service role can manage hs_evidence"
ON public.hs_evidence FOR ALL
USING (true)
WITH CHECK (true);

-- =============================================
-- 4) Index sur country_tariffs
-- =============================================
CREATE INDEX IF NOT EXISTS country_tariffs_national_code_idx
ON public.country_tariffs(country_code, national_code);

-- =============================================
-- 5) Index sur tariff_notes (GIN full-text)
-- =============================================
CREATE INDEX IF NOT EXISTS tariff_notes_country_chapter_idx
ON public.tariff_notes(country_code, chapter_number);

CREATE INDEX IF NOT EXISTS tariff_notes_text_gin_idx
ON public.tariff_notes USING GIN (to_tsvector('french', note_text));

-- =============================================
-- 6) Index sur hs_evidence
-- =============================================
CREATE INDEX IF NOT EXISTS hs_evidence_code_idx
ON public.hs_evidence(country_code, national_code);

CREATE INDEX IF NOT EXISTS hs_evidence_source_idx
ON public.hs_evidence(source_id);