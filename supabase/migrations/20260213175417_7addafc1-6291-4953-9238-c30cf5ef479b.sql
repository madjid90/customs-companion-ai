-- Remove the manager policy that allows viewing all conversations
DROP POLICY IF EXISTS "Managers can view all conversations" ON public.conversations;
