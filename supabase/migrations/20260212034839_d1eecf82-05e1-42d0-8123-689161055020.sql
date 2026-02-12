
-- 1. Add INSERT/UPDATE/DELETE policies for admins on tariff_notes
CREATE POLICY "Admins can insert tariff_notes"
ON public.tariff_notes
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update tariff_notes"
ON public.tariff_notes
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete tariff_notes"
ON public.tariff_notes
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. Add unique constraint on pdf_extractions.pdf_id for upsert
ALTER TABLE public.pdf_extractions
ADD CONSTRAINT pdf_extractions_pdf_id_unique UNIQUE (pdf_id);
