-- Add a unique salt column to phone_users for OTP password derivation
ALTER TABLE public.phone_users
ADD COLUMN IF NOT EXISTS password_salt TEXT;

-- Generate unique salts for existing users
UPDATE public.phone_users
SET password_salt = encode(gen_random_bytes(32), 'hex')
WHERE password_salt IS NULL;