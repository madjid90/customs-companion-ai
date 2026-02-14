
-- Step 1: Delete duplicate pdf_documents keeping the best entry per document_reference
-- Keep the one that is verified first, then has a publication_date, then oldest created_at
DELETE FROM pdf_documents
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY document_reference 
        ORDER BY is_verified DESC NULLS LAST, publication_date DESC NULLS LAST, created_at ASC
      ) as rn
    FROM pdf_documents
    WHERE category ILIKE '%circulaire%' 
      AND is_active = true 
      AND document_reference IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Step 2: Also clean up duplicate titles where document_reference is NULL
-- These are orphan duplicates with generic titles
DELETE FROM pdf_documents
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY title, file_name
        ORDER BY is_verified DESC NULLS LAST, publication_date DESC NULLS LAST, created_at ASC
      ) as rn
    FROM pdf_documents
    WHERE category ILIKE '%circulaire%' 
      AND is_active = true 
      AND document_reference IS NULL
  ) ranked
  WHERE rn > 1
);

-- Step 3: Add partial unique index on document_reference for active circulars
-- This prevents future duplicates from being created during re-ingestion
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_documents_unique_doc_ref 
ON pdf_documents (document_reference) 
WHERE document_reference IS NOT NULL AND is_active = true;
