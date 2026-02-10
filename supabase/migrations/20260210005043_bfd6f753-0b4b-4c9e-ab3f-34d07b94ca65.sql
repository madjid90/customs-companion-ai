-- Allow admins to INSERT into hs_codes
CREATE POLICY "Admins can insert hs_codes"
ON public.hs_codes
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Allow admins to UPDATE hs_codes
CREATE POLICY "Admins can update hs_codes"
ON public.hs_codes
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Allow admins to DELETE hs_codes
CREATE POLICY "Admins can delete hs_codes"
ON public.hs_codes
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Also fix country_tariffs if same issue exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'country_tariffs' AND cmd = 'INSERT') THEN
    CREATE POLICY "Admins can insert country_tariffs"
    ON public.country_tariffs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'country_tariffs' AND cmd = 'UPDATE') THEN
    CREATE POLICY "Admins can update country_tariffs"
    ON public.country_tariffs
    FOR UPDATE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'country_tariffs' AND cmd = 'DELETE') THEN
    CREATE POLICY "Admins can delete country_tariffs"
    ON public.country_tariffs
    FOR DELETE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;