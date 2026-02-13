
-- Drop old session-based RLS policies
DROP POLICY IF EXISTS "Users read own session conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users update own session conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users delete own session conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users create conversations" ON public.conversations;

-- Create new user_id-based RLS policies
CREATE POLICY "Users can read own conversations"
ON public.conversations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
ON public.conversations FOR INSERT
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own conversations"
ON public.conversations FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
ON public.conversations FOR DELETE
USING (auth.uid() = user_id);

-- Keep the manager policy as-is (already exists)
