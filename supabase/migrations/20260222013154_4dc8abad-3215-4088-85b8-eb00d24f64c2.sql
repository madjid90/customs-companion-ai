
-- Ajouter agreement_code à country_tariffs pour les taux préférentiels
ALTER TABLE public.country_tariffs
ADD COLUMN IF NOT EXISTS agreement_code VARCHAR REFERENCES public.trade_agreements(code);

-- Index pour recherche rapide par accord
CREATE INDEX IF NOT EXISTS idx_country_tariffs_agreement ON public.country_tariffs(agreement_code)
WHERE agreement_code IS NOT NULL;

-- Compléter les champs manquants des accords existants
-- Ajouter les colonnes manquantes à trade_agreements si nécessaire
ALTER TABLE public.trade_agreements
ADD COLUMN IF NOT EXISTS preferential_duty_rate NUMERIC,
ADD COLUMN IF NOT EXISTS countries_covered TEXT[];

COMMENT ON COLUMN public.country_tariffs.agreement_code IS 'Code de l''accord commercial applicable pour ce taux préférentiel (NULL = taux de droit commun)';
COMMENT ON COLUMN public.trade_agreements.preferential_duty_rate IS 'Taux de droit préférentiel par défaut de l''accord (%)';
COMMENT ON COLUMN public.trade_agreements.countries_covered IS 'Liste des codes pays ISO couverts par l''accord';
