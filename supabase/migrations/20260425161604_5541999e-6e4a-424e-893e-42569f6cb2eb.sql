-- ============================================
-- AUDIT BD - CORRECTIONS CRITIQUES
-- ============================================

-- 1. STORAGE: Restreindre INSERT/UPDATE/DELETE sur pdf-documents aux admins
DROP POLICY IF EXISTS "Service role can upload PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete PDFs" ON storage.objects;

CREATE POLICY "Admins can upload PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'pdf-documents' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update PDFs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'pdf-documents' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete PDFs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'pdf-documents' AND has_role(auth.uid(), 'admin'::app_role));

-- 2. DUM_DOCUMENTS / DUM_ITEMS: Restreindre lecture aux authentifiés
DROP POLICY IF EXISTS "dum_documents_public_read" ON public.dum_documents;
DROP POLICY IF EXISTS "dum_items_public_read" ON public.dum_items;

CREATE POLICY "Authenticated users can read dum_documents"
ON public.dum_documents FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage dum_documents"
ON public.dum_documents FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can read dum_items"
ON public.dum_items FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage dum_items"
ON public.dum_items FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. LEGAL_CHUNKS: Supprimer la policy SELECT redondante
DROP POLICY IF EXISTS "legal_chunks_public_read" ON public.legal_chunks;

-- 4. EMBEDDING_QUEUE: Reset des jobs bloqués (>1h pending) pour relance
UPDATE public.embedding_queue
SET status = 'pending', attempts = 0, error_message = NULL
WHERE status = 'pending' AND created_at < now() - interval '1 hour';