-- Drop the restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view own consultations" ON public.consultations;

-- Create a new policy that allows authenticated users to see consultations
-- with matching user_id OR null user_id (legacy data)
CREATE POLICY "Users can view consultations"
  ON public.consultations
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      user_id IS NULL
      OR user_id IN (
        SELECT phone_users.id FROM phone_users WHERE phone_users.auth_user_id = auth.uid()
      )
    )
  );