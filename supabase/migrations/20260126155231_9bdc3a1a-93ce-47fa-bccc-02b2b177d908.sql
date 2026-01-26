-- Add new columns for improved PDF extraction
ALTER TABLE public.country_tariffs 
ADD COLUMN IF NOT EXISTS duty_note character varying(10) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_inherited boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.country_tariffs.duty_note IS 'Reference to footnote (a, b, c, etc.) for special duty conditions';
COMMENT ON COLUMN public.country_tariffs.is_inherited IS 'True if the national code was reconstructed via inheritance logic';