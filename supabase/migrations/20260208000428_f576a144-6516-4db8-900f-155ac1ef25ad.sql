
-- RPC function to count conversations grouped by user_id (replaces N sequential queries)
CREATE OR REPLACE FUNCTION public.count_conversations_by_users(user_ids UUID[])
RETURNS TABLE(user_id UUID, conversation_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.user_id, COUNT(*) AS conversation_count
  FROM conversations c
  WHERE c.user_id = ANY(user_ids)
  GROUP BY c.user_id;
$$;
