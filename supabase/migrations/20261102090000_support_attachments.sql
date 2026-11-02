-- Support chat attachments.
-- Run this migration in the linked Supabase project before deploying the updated frontend.

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_mime_type text;

-- Private bucket: files are only readable by members of the related conversation or admins.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "support participants can upload attachments" ON storage.objects;
CREATE POLICY "support participants can upload attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'support-attachments'
  AND EXISTS (
    SELECT 1 FROM public.support_conversations c
    WHERE c.id::text = split_part(name, '/', 1)
      AND (c.user_id = auth.uid() OR public.is_admin(auth.uid()))
  )
);

DROP POLICY IF EXISTS "support participants can read attachments" ON storage.objects;
CREATE POLICY "support participants can read attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'support-attachments'
  AND EXISTS (
    SELECT 1 FROM public.support_conversations c
    WHERE c.id::text = split_part(name, '/', 1)
      AND (c.user_id = auth.uid() OR public.is_admin(auth.uid()))
  )
);

-- Replace the original text-only RPC with an attachment-aware version.
DROP FUNCTION IF EXISTS public.send_support_message(uuid, text);

CREATE OR REPLACE FUNCTION public.send_support_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_path text DEFAULT NULL,
  p_attachment_name text DEFAULT NULL,
  p_attachment_mime_type text DEFAULT NULL
)
RETURNS public.support_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_conv public.support_conversations;
  v_role text;
  v_msg public.support_messages;
  v_trimmed text := trim(COALESCE(p_body, ''));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to send a message.';
  END IF;

  IF v_trimmed = '' AND p_attachment_path IS NULL THEN
    RAISE EXCEPTION 'Message or attachment is required.';
  END IF;

  SELECT * INTO v_conv FROM public.support_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  IF v_conv.user_id = v_user THEN
    v_role := 'customer';
  ELSIF public.is_admin(v_user) THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this conversation.';
  END IF;

  IF p_attachment_path IS NOT NULL THEN
    IF split_part(p_attachment_path, '/', 1) <> p_conversation_id::text
       OR p_attachment_name IS NULL
       OR p_attachment_mime_type IS NULL
       OR p_attachment_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') THEN
      RAISE EXCEPTION 'Invalid support attachment.';
    END IF;
  END IF;

  INSERT INTO public.support_messages (
    conversation_id, sender_id, sender_role, body,
    attachment_path, attachment_name, attachment_mime_type
  )
  VALUES (
    p_conversation_id, v_user, v_role,
    COALESCE(NULLIF(v_trimmed, ''), 'Attachment: ' || COALESCE(p_attachment_name, 'file')),
    p_attachment_path, p_attachment_name, p_attachment_mime_type
  )
  RETURNING * INTO v_msg;

  UPDATE public.support_conversations
  SET last_message_at = v_msg.created_at,
      updated_at = now(),
      customer_unread_count = CASE WHEN v_role = 'admin' THEN customer_unread_count + 1 ELSE customer_unread_count END,
      admin_unread_count = CASE WHEN v_role = 'customer' THEN admin_unread_count + 1 ELSE admin_unread_count END,
      status = CASE
        WHEN v_role = 'admin' AND status <> 'resolved' THEN 'waiting_for_customer'
        WHEN v_role = 'customer' AND status = 'waiting_for_customer' THEN 'open'
        ELSE status
      END
  WHERE id = p_conversation_id;

  RETURN v_msg;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_support_message(uuid, text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_support_message(uuid, text, text, text, text) TO authenticated;


-- The admin inbox must return every customer's conversation, but never expose
-- the inbox to ordinary signed-in customers. The previous function was
-- SECURITY DEFINER without an admin check.
CREATE OR REPLACE FUNCTION public.admin_list_support_conversations()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  customer_name text,
  customer_account_id text,
  customer_email text,
  status text,
  assigned_admin_name text,
  last_message text,
  last_message_at timestamptz,
  admin_unread_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.user_id,
    COALESCE(p.display_name, 'Customer')::text,
    COALESCE(p.account_id, '')::text,
    COALESCE(p.email, '')::text,
    c.status::text,
    a.display_name::text,
    (SELECT m.body FROM public.support_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1),
    c.last_message_at,
    c.admin_unread_count,
    c.created_at
  FROM public.support_conversations c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  LEFT JOIN public.profiles a ON a.id = c.assigned_admin_id
  ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_support_conversations() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_support_conversations() TO authenticated;
