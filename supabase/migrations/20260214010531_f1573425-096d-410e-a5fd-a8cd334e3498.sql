
-- Supprimer les 19 doublons pdf_documents avec préfixe "circular_" redondant
-- Ce sont des entrées qui ont une version sans le préfixe "circular_" déjà existante
DELETE FROM pdf_documents
WHERE category ILIKE '%circulaire%'
  AND is_active = true
  AND document_reference LIKE 'circular_%'
  AND EXISTS (
    SELECT 1 FROM pdf_documents pd2
    WHERE pd2.category ILIKE '%circulaire%'
      AND pd2.is_active = true
      AND pd2.id != pdf_documents.id
      AND pd2.document_reference = replace(pdf_documents.document_reference, 'circular_', '')
  );

-- Supprimer aussi les legal_sources orphelins avec le même préfixe redondant
DELETE FROM legal_sources
WHERE source_ref LIKE 'circular_%'
  AND source_type = 'circular'
  AND total_chunks = 0
  AND EXISTS (
    SELECT 1 FROM legal_sources ls2
    WHERE ls2.source_ref = replace(legal_sources.source_ref, 'circular_', '')
      AND ls2.source_type = 'circular'
  );
