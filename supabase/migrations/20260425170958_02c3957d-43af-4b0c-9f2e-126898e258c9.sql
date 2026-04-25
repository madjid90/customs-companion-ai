
-- ============================================================================
-- 1. CRÉER TABLE vat_rules : Référentiel TVA Maroc (CGI 2024)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vat_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vat_rate NUMERIC NOT NULL,
  cgi_article TEXT NOT NULL,
  category TEXT NOT NULL,
  description_fr TEXT NOT NULL,
  description_ar TEXT,
  hs_code_pattern TEXT,
  hs_code_start VARCHAR(10),
  hs_code_end VARCHAR(10),
  legal_basis TEXT NOT NULL DEFAULT 'CGI 2024',
  source_url TEXT DEFAULT 'https://www.tax.gov.ma',
  effective_date DATE DEFAULT '2024-01-01',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vat_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VAT rules are publicly readable"
  ON public.vat_rules FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage vat_rules"
  ON public.vat_rules FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_vat_rules_updated_at
  BEFORE UPDATE ON public.vat_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_vat_rules_rate ON public.vat_rules(vat_rate);
CREATE INDEX idx_vat_rules_hs_range ON public.vat_rules(hs_code_start, hs_code_end);

-- ============================================================================
-- 2. CHARGER LES RÈGLES DE TVA (CGI 2024)
-- ============================================================================
INSERT INTO public.vat_rules (vat_rate, cgi_article, category, description_fr, description_ar, hs_code_start, hs_code_end) VALUES
-- Taux 0% (Article 91 - Exonérations sans droit à déduction)
(0, 'Art. 91-I-A', 'Médicaments essentiels', 'Médicaments anticancéreux, antiviraux hépatites B/C, médicaments du SIDA', 'الأدوية المضادة للسرطان والفيروسات', '3003', '3004'),
(0, 'Art. 91-I-E', 'Presse et livres', 'Journaux, publications, livres', 'الصحف والكتب', '4901', '4902'),
(0, 'Art. 91-I-F', 'Timbres', 'Timbres fiscaux et timbres-poste', 'الطوابع', '4907', '4907'),

-- Taux 7% (Article 99-1°)
(7, 'Art. 99-1°-a', 'Eau', 'Eau livrée aux réseaux de distribution publique', 'الماء', '2201', '2201'),
(7, 'Art. 99-1°-b', 'Produits pharmaceutiques', 'Médicaments et produits pharmaceutiques (hors exonérés)', 'الأدوية', '3001', '3006'),
(7, 'Art. 99-1°-c', 'Sucre raffiné', 'Sucre raffiné ou aggloméré', 'السكر المكرر', '1701', '1701'),
(7, 'Art. 99-1°-d', 'Conserves de sardines', 'Conserves de sardines, anchois, thon', 'معلبات السردين', '1604', '1605'),
(7, 'Art. 99-1°-e', 'Lait en poudre', 'Lait en poudre destiné à l''alimentation', 'الحليب المجفف', '0402', '0402'),
(7, 'Art. 99-1°-f', 'Savon de ménage', 'Savon de ménage en morceaux ou en pains', 'الصابون', '3401', '3401'),
(7, 'Art. 99-1°-g', 'Fournitures scolaires', 'Cartables, cahiers, articles scolaires', 'اللوازم المدرسية', '4202', '4820'),

-- Taux 10% (Article 99-2°)
(10, 'Art. 99-2°-a', 'Pâtes alimentaires', 'Pâtes alimentaires', 'العجائن الغذائية', '1902', '1902'),
(10, 'Art. 99-2°-b', 'Sel de cuisine', 'Sel de cuisine (gemme ou de mer)', 'ملح الطعام', '2501', '2501'),
(10, 'Art. 99-2°-c', 'Riz usiné', 'Riz usiné', 'الأرز المصنع', '1006', '1006'),
(10, 'Art. 99-2°-d', 'Gaz de pétrole', 'Gaz de pétrole et autres hydrocarbures gazeux', 'غاز البترول', '2711', '2711'),

-- Taux 14% (Article 99-3°)
(14, 'Art. 99-3°-a', 'Beurre', 'Beurre, à l''exclusion du beurre de fabrication artisanale', 'الزبدة', '0405', '0405'),
(14, 'Art. 99-3°-b', 'Énergie électrique', 'Énergie électrique', 'الطاقة الكهربائية', '2716', '2716'),
(14, 'Art. 99-3°-c', 'Café', 'Café, thé', 'القهوة والشاي', '0901', '0902'),

-- Taux 20% (Article 98 - Taux normal par défaut)
(20, 'Art. 98', 'Taux normal', 'Taux normal applicable à toutes les opérations imposables non soumises aux taux réduits', 'النسبة العادية', NULL, NULL);

-- ============================================================================
-- 3. APPLIQUER LES TAUX RÉDUITS SUR country_tariffs (Maroc uniquement)
-- ============================================================================

-- TVA 0% : Médicaments essentiels (Art. 91)
UPDATE public.country_tariffs
SET vat_rate = 0, updated_at = now()
WHERE country_code = 'MA'
  AND is_active = true
  AND (national_code LIKE '4901%' OR national_code LIKE '4902%' OR national_code LIKE '4907%');

-- TVA 7% : Produits pharmaceutiques (Chapitre 30)
UPDATE public.country_tariffs
SET vat_rate = 7, updated_at = now()
WHERE country_code = 'MA'
  AND is_active = true
  AND national_code LIKE '30%';

-- TVA 7% : Eau, sucre, conserves poisson, lait poudre, savon
UPDATE public.country_tariffs
SET vat_rate = 7, updated_at = now()
WHERE country_code = 'MA'
  AND is_active = true
  AND (
    national_code LIKE '2201%'  -- eau
    OR national_code LIKE '1701%'  -- sucre raffiné
    OR national_code LIKE '1604%'  -- conserves poisson
    OR national_code LIKE '1605%'  -- crustacés conservés
    OR national_code LIKE '0402%'  -- lait en poudre
    OR national_code LIKE '3401%'  -- savon
  );

-- TVA 10% : Pâtes, sel, riz, gaz pétrole
UPDATE public.country_tariffs
SET vat_rate = 10, updated_at = now()
WHERE country_code = 'MA'
  AND is_active = true
  AND (
    national_code LIKE '1902%'  -- pâtes
    OR national_code LIKE '2501%'  -- sel
    OR national_code LIKE '1006%'  -- riz
    OR national_code LIKE '2711%'  -- gaz pétrole
  );

-- TVA 14% : Beurre, énergie électrique, café, thé
UPDATE public.country_tariffs
SET vat_rate = 14, updated_at = now()
WHERE country_code = 'MA'
  AND is_active = true
  AND (
    national_code LIKE '0405%'  -- beurre
    OR national_code LIKE '2716%'  -- électricité
    OR national_code LIKE '0901%'  -- café
    OR national_code LIKE '0902%'  -- thé
  );
