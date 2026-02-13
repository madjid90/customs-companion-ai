
-- Add email column to access_requests for email-based access requests
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE access_requests ALTER COLUMN phone DROP NOT NULL;
