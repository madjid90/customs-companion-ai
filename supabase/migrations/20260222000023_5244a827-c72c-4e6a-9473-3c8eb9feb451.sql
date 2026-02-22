
-- Table des équipements homologués ANRT
CREATE TABLE public.anrt_approved_equipment (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  designation text NOT NULL,
  brand text,
  type_ref text,
  model text,
  approval_number text,
  approval_date date,
  expiry_date date,
  equipment_category text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index pour recherche rapide
CREATE INDEX idx_anrt_designation_trgm ON public.anrt_approved_equipment USING gin (designation gin_trgm_ops);
CREATE INDEX idx_anrt_brand ON public.anrt_approved_equipment (brand);
CREATE INDEX idx_anrt_type_ref ON public.anrt_approved_equipment (type_ref);
CREATE INDEX idx_anrt_approval_number ON public.anrt_approved_equipment (approval_number);

-- Enable RLS
ALTER TABLE public.anrt_approved_equipment ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "ANRT equipment is publicly readable"
  ON public.anrt_approved_equipment
  FOR SELECT
  USING (is_active = true);

-- Admin management
CREATE POLICY "Admins can manage anrt_approved_equipment"
  ON public.anrt_approved_equipment
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Fonction de recherche full-text + trigram
CREATE OR REPLACE FUNCTION public.search_anrt_equipment(
  p_query text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  designation text,
  brand text,
  type_ref text,
  model text,
  approval_number text,
  approval_date date,
  equipment_category text,
  similarity_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.designation,
    a.brand,
    a.type_ref,
    a.model,
    a.approval_number,
    a.approval_date,
    a.equipment_category,
    greatest(
      similarity(lower(a.designation), lower(p_query)),
      similarity(lower(coalesce(a.brand, '')), lower(p_query)),
      similarity(lower(coalesce(a.type_ref, '')), lower(p_query))
    )::real AS similarity_score
  FROM public.anrt_approved_equipment a
  WHERE a.is_active = true
    AND (
      a.designation ILIKE '%' || p_query || '%'
      OR a.brand ILIKE '%' || p_query || '%'
      OR a.type_ref ILIKE '%' || p_query || '%'
      OR a.model ILIKE '%' || p_query || '%'
      OR similarity(lower(a.designation), lower(p_query)) > 0.15
    )
  ORDER BY similarity_score DESC
  LIMIT p_limit;
END;
$$;
