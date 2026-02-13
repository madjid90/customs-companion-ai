
-- Remove all manager-specific policies from phone_users
DROP POLICY IF EXISTS "Managers can view all phone users" ON public.phone_users;
DROP POLICY IF EXISTS "Managers can insert phone users" ON public.phone_users;
DROP POLICY IF EXISTS "Managers can update phone users" ON public.phone_users;
DROP POLICY IF EXISTS "Managers can delete phone users" ON public.phone_users;

-- Ensure admins can manage phone_users instead
CREATE POLICY "Admins can view all phone users"
ON public.phone_users FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert phone users"
ON public.phone_users FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update phone users"
ON public.phone_users FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete phone users"
ON public.phone_users FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
