-- ============================================================================
-- OTP CLEANUP: Scheduled deletion of expired OTP codes
-- ============================================================================

-- Create a function to cleanup expired OTP codes
CREATE OR REPLACE FUNCTION public.cleanup_expired_otp_codes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.otp_codes 
  WHERE expires_at < now() - INTERVAL '1 day';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Schedule cleanup using pg_cron (runs daily at 3am UTC)
SELECT cron.schedule(
  'cleanup-expired-otp',
  '0 3 * * *',
  $$SELECT public.cleanup_expired_otp_codes()$$
);