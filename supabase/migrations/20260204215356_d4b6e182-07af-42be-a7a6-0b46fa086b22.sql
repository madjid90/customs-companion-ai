-- Increase reference_number column size to accommodate longer references
ALTER TABLE public.legal_references 
ALTER COLUMN reference_number TYPE VARCHAR(255);