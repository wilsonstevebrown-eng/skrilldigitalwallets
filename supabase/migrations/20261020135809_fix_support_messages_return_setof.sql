-- Root cause: my_support_messages was declared RETURNS public.support_messages (singular)
-- which makes PostgREST return a single JSON object instead of an array when messages exist.
-- The browser then calls .map() on an object and crashes, rendering the Support tab blank.
-- Fix: DROP and recreate as RETURNS SETOF so PostgREST returns an array.

DROP FUNCTION IF EXISTS public.my_support_messages(uuid);

CREATE FUNCTION public.my_support_messages(p_conversation_id uuid)
RETURNS SETOF public.support_messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.*
  FROM public.support_messages m
  JOIN public.support_conversations c ON c.id = m.conversation_id
  WHERE c.id = p_conversation_id
    AND (c.user_id = auth.uid() OR public.is_admin(auth.uid()))
  ORDER BY m.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.my_support_messages FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_support_messages TO authenticated;
