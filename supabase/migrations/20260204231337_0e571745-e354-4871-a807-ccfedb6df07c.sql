-- Increase context column size to accommodate longer context texts
ALTER TABLE public.legal_references 
ALTER COLUMN context TYPE TEXT;