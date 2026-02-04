-- Add unique constraint for legal_references to support upsert
-- This allows the ingest-legal-doc function to properly deduplicate references
ALTER TABLE public.legal_references 
ADD CONSTRAINT legal_references_ref_type_unique 
UNIQUE (reference_number, reference_type);