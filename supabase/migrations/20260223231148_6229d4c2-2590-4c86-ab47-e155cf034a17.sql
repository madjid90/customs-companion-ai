
-- Table pour les équipements dispensés d'homologation ANRT
CREATE TABLE public.anrt_dispensed_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  designation text NOT NULL,
  brand text,
  type_model text,
  dispensation_number text,
  brand_normalized text,
  search_text text,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index plein texte pour recherche performante
CREATE INDEX idx_anrt_dispensed_search ON public.anrt_dispensed_equipment USING GIN (to_tsvector('french', coalesce(search_text, '')));
CREATE INDEX idx_anrt_dispensed_brand ON public.anrt_dispensed_equipment (brand_normalized);
CREATE INDEX idx_anrt_dispensed_active ON public.anrt_dispensed_equipment (is_active) WHERE is_active = true;

-- RLS
ALTER TABLE public.anrt_dispensed_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dispensed equipment is publicly readable"
ON public.anrt_dispensed_equipment FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage anrt_dispensed_equipment"
ON public.anrt_dispensed_equipment FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Fonction de recherche similaire à search_anrt_equipment
CREATE OR REPLACE FUNCTION public.search_anrt_dispensed_equipment(search_query text, max_results int DEFAULT 10)
RETURNS SETOF public.anrt_dispensed_equipment
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.anrt_dispensed_equipment
  WHERE is_active = true
    AND (
      to_tsvector('french', coalesce(search_text, '')) @@ plainto_tsquery('french', search_query)
      OR search_text ILIKE '%' || search_query || '%'
    )
  ORDER BY
    ts_rank(to_tsvector('french', coalesce(search_text, '')), plainto_tsquery('french', search_query)) DESC
  LIMIT max_results;
$$;
