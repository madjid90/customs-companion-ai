
-- ============================================================
-- 1. ADD RLS POLICIES TO 7 ORPHAN TABLES
-- ============================================================

CREATE POLICY "Admins can manage response_cache"
ON public.response_cache FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can read statistics"
ON public.statistics FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage veille_config"
ON public.veille_config FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage veille_documents"
ON public.veille_documents FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Veille documents are publicly readable"
ON public.veille_documents FOR SELECT
USING (true);

CREATE POLICY "Admins can manage veille_keywords"
ON public.veille_keywords FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage veille_logs"
ON public.veille_logs FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage veille_sites"
ON public.veille_sites FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 2. FIX OVERLY PERMISSIVE "ALWAYS TRUE" POLICIES
-- ============================================================

DROP POLICY IF EXISTS "legal_chunks_service_write" ON public.legal_chunks;
CREATE POLICY "Admins can manage legal_chunks"
ON public.legal_chunks FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role only for otp_codes" ON public.otp_codes;
CREATE POLICY "Admins can manage otp_codes"
ON public.otp_codes FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow all for pdf_extraction_runs" ON public.pdf_extraction_runs;

-- ============================================================
-- 3. FIX FUNCTIONS WITHOUT search_path
-- ============================================================

-- Drop both overloads of get_tariff_details
DROP FUNCTION IF EXISTS public.get_tariff_details(text, text);
DROP FUNCTION IF EXISTS public.get_tariff_details(varchar, varchar);

-- Recreate first overload with search_path
CREATE OR REPLACE FUNCTION public.get_tariff_details(p_hs_code text, p_country text DEFAULT 'MA'::text)
RETURNS TABLE(hs_code_6 text, national_code text, description_local text, duty_rate numeric, vat_rate numeric, other_taxes jsonb, is_prohibited boolean, is_restricted boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ct.hs_code_6::text,
    ct.national_code::text,
    ct.description_local,
    ct.duty_rate,
    ct.vat_rate,
    ct.other_taxes,
    ct.is_prohibited,
    ct.is_restricted
  FROM public.country_tariffs ct
  WHERE ct.national_code LIKE p_hs_code || '%'
    AND ct.country_code = p_country
    AND ct.is_active = true
  ORDER BY ct.national_code;
$$;

-- Recreate second overload with search_path
CREATE OR REPLACE FUNCTION public.get_tariff_details(p_country_code varchar, p_hs_code varchar)
RETURNS TABLE(hs_code varchar, national_code varchar, description text, duty_rate numeric, vat_rate numeric, is_controlled boolean, control_type varchar, control_authority varchar)
LANGUAGE plpgsql
SET search_path = public
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
            SELECT 1 FROM public.controlled_products cp 
            WHERE cp.hs_code LIKE t.hs_code_6 || '%' 
            AND cp.country_code = p_country_code
            AND cp.is_active = true
        ),
        (
            SELECT cp.control_type FROM public.controlled_products cp 
            WHERE cp.hs_code LIKE t.hs_code_6 || '%' 
            AND cp.country_code = p_country_code 
            AND cp.is_active = true
            LIMIT 1
        ),
        (
            SELECT cp.control_authority FROM public.controlled_products cp 
            WHERE cp.hs_code LIKE t.hs_code_6 || '%' 
            AND cp.country_code = p_country_code 
            AND cp.is_active = true
            LIMIT 1
        )
    FROM public.country_tariffs t
    LEFT JOIN public.hs_codes h ON h.code_clean = t.hs_code_6
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

-- Fix search_hs_codes
DROP FUNCTION IF EXISTS public.search_hs_codes(text);
CREATE OR REPLACE FUNCTION public.search_hs_codes(search_query text)
RETURNS SETOF public.hs_codes
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT * FROM public.hs_codes
  WHERE is_active = true
  AND (
    code ILIKE '%' || search_query || '%'
    OR code_clean ILIKE '%' || search_query || '%'
    OR description_fr ILIKE '%' || search_query || '%'
    OR description_en ILIKE '%' || search_query || '%'
  )
  ORDER BY code
  LIMIT 50;
$$;

-- Fix update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix update_dum_documents_updated_at
CREATE OR REPLACE FUNCTION public.update_dum_documents_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
