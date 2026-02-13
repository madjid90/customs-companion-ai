
-- Add email column to phone_users (unique, nullable for migration)
ALTER TABLE phone_users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

-- Make phone nullable since new users will use email
ALTER TABLE phone_users ALTER COLUMN phone DROP NOT NULL;

-- Add email column to otp_codes for email-based OTP
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS email TEXT;
