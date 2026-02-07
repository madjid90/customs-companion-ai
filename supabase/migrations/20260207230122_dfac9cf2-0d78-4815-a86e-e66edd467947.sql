-- P1: Add composite index on otp_codes for performance
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_used_expires 
ON public.otp_codes (phone, is_used, expires_at);

-- P1: Add UNIQUE constraint on access_requests(phone) to prevent duplicates
-- First, deduplicate existing rows (keep latest per phone)
DELETE FROM public.access_requests a
USING public.access_requests b
WHERE a.phone = b.phone 
  AND a.created_at < b.created_at;

ALTER TABLE public.access_requests 
ADD CONSTRAINT access_requests_phone_unique UNIQUE (phone);

-- P0: Ensure reviewed_by column exists for audit trail
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'access_requests' 
    AND column_name = 'reviewed_by'
  ) THEN
    ALTER TABLE public.access_requests 
    ADD COLUMN reviewed_by UUID REFERENCES auth.users(id);
  END IF;
END $$;