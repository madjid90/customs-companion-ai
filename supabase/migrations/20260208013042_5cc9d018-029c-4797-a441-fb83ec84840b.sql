-- Allow admins to INSERT pdf_documents
CREATE POLICY "Admins can insert pdf_documents"
  ON public.pdf_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Allow admins to UPDATE pdf_documents
CREATE POLICY "Admins can update pdf_documents"
  ON public.pdf_documents
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to DELETE pdf_documents
CREATE POLICY "Admins can delete pdf_documents"
  ON public.pdf_documents
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Also check related tables that admins need to write to during upload/extraction
-- pdf_extractions
CREATE POLICY "Admins can insert pdf_extractions"
  ON public.pdf_extractions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update pdf_extractions"
  ON public.pdf_extractions
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- pdf_extraction_runs
CREATE POLICY "Admins can insert pdf_extraction_runs"
  ON public.pdf_extraction_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update pdf_extraction_runs"
  ON public.pdf_extraction_runs
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can select pdf_extraction_runs"
  ON public.pdf_extraction_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));