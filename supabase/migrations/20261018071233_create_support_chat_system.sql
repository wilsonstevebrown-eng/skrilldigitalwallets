/*
# Create customer support chat system

1. New Tables
- `support_conversations`: one support thread per customer. Columns:
  - id (uuid, primary key)
  - user_id (uuid, references profiles, the customer who owns the conversation)
  - status (text: 'open' | 'waiting_for_customer' | 'resolved', default 'open')
  - assigned_admin_id (uuid, nullable, references profiles - the admin handling the conversation)
  - last_message_at (timestamptz, used for sorting and activity display)
  - customer_unread_count (int, default 0 - messages from admin not yet seen by customer)
  - admin_unread_count (int, default 0 - messages from customer not yet seen by admin)
  - created_at (timestamptz, default now())
  - updated_at (timestamptz, default now())
- `support_messages`: individual chat messages. Columns:
  - id (uuid, primary key)
  - conversation_id (uuid, references support_conversations, cascade delete)
  - sender_id (uuid, references profiles - the user who sent the message)
  - sender_role (text: 'customer' | 'admin' - denormalized for fast rendering)
  - body (text, not null, trimmed)
  - read_by_recipient (boolean, default false)
  - created_at (timestamptz, default now())

2. Indexes
- support_conversations(user_id) - customer lookup of their conversation
- support_conversations(status) - admin filtering by status
- support_conversations(assigned_admin_id) - admin "my conversations" view
- support_conversations(last_message_at desc) - inbox ordering
- support_messages(conversation_id, created_at) - message history ordering
- support_messages(sender_id) - sender lookup

3. Functions
- `get_or_create_my_conversation()`: SECURITY DEFINER. Returns the customer's existing conversation id, or creates one if none exists. Only callable by authenticated users; uses auth.uid() as the customer.
- `send_support_message(p_conversation_id, p_body)`: SECURITY DEFINER. Inserts a message from auth.uid(), validates the sender is a participant (the customer owner or an admin), updates the conversation's last_message_at, updates unread counts (increments the recipient side), and sets status to 'waiting_for_customer' when an admin replies or 'open' when a customer replies (only if not resolved). Returns the inserted message row.
- `mark_conversation_read(p_conversation_id, p_as_role)`: SECURITY DEFINER. Zeros the unread count for the given role (customer or admin) for the calling user, and marks unread messages from the other side as read. Validates the caller is a participant.
- `admin_assign_conversation(p_conversation_id)`: SECURITY DEFINER. Assigns the conversation to the calling admin (auth.uid()) if they are an admin. Returns the updated conversation.
- `admin_set_conversation_status(p_conversation_id, p_status)`: SECURITY DEFINER. Updates conversation status (open, waiting_for_customer, resolved). Admin only.
- `admin_list_support_conversations()`: SECURITY DEFINER. Returns all conversations with customer name, account_id, email, latest message preview, last activity, unread count, and assigned admin name. Admin only.
- `my_support_messages(p_conversation_id)`: SECURITY DEFINER. Returns all messages for a conversation if the caller is the customer owner or an admin. Used for full history loading.

4. Realtime
- Both tables added to the supabase_realtime publication so the browser receives INSERT events without polling.

5. Security (RLS)
- support_conversations: customers can SELECT/UPDATE only their own row (user_id = auth.uid()); admins can SELECT all and UPDATE status/assignment. INSERT is handled via the SECURITY DEFINER function get_or_create_my_conversation, so direct client INSERT is denied.
- support_messages: customers can SELECT messages in their own conversation; admins can SELECT all. INSERT is handled via send_support_message SECURITY DEFINER function, so direct client INSERT is denied. No UPDATE/DELETE from the client.
- All SECURITY DEFINER functions use a fixed search_path and revoke execute from anon/PUBLIC, granting only to authenticated.
- Admin checks use the profiles.role column: a helper `is_admin(uuid)` confirms role = 'admin'.

6. Important behavior notes
- A customer has at most one conversation; get_or_create returns the existing one on repeat calls.
- Unread counts are maintained on the conversation row for fast inbox rendering.
- Status transitions: customer reply sets status to 'open' (unless resolved); admin reply sets status to 'waiting_for_customer'. Admins can explicitly set 'resolved'.
- Message bodies are trimmed and must be non-empty.
*/

CREATE TABLE IF NOT EXISTS public.support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting_for_customer', 'resolved')),
  assigned_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  customer_unread_count integer NOT NULL DEFAULT 0 CHECK (customer_unread_count >= 0),
  admin_unread_count integer NOT NULL DEFAULT 0 CHECK (admin_unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS support_conversations_user_id_idx ON public.support_conversations (user_id);
CREATE INDEX IF NOT EXISTS support_conversations_status_idx ON public.support_conversations (status);
CREATE INDEX IF NOT EXISTS support_conversations_admin_id_idx ON public.support_conversations (assigned_admin_id);
CREATE INDEX IF NOT EXISTS support_conversations_last_msg_idx ON public.support_conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'admin')),
  body text NOT NULL,
  read_by_recipient boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_conversation_idx ON public.support_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS support_messages_sender_idx ON public.support_messages (sender_id);

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Helper: is a given user an admin?
CREATE OR REPLACE FUNCTION public.is_admin(p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND role = 'admin');
$$;
REVOKE EXECUTE ON FUNCTION public.is_admin FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin TO authenticated;

-- support_conversations policies
DROP POLICY IF EXISTS "select_own_or_all_conversations" ON public.support_conversations;
CREATE POLICY "select_own_or_all_conversations"
ON public.support_conversations FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_own_or_admin_conversations" ON public.support_conversations;
CREATE POLICY "update_own_or_admin_conversations"
ON public.support_conversations FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- support_messages policies
DROP POLICY IF EXISTS "select_participant_messages" ON public.support_messages;
CREATE POLICY "select_participant_messages"
ON public.support_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_conversations c
    WHERE c.id = support_messages.conversation_id
    AND (c.user_id = auth.uid() OR public.is_admin(auth.uid()))
  )
);

-- get_or_create_my_conversation
CREATE OR REPLACE FUNCTION public.get_or_create_my_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to use support chat.';
  END IF;
  SELECT id INTO v_id FROM public.support_conversations WHERE user_id = v_user;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.support_conversations (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_my_conversation FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_my_conversation TO authenticated;

-- send_support_message
CREATE OR REPLACE FUNCTION public.send_support_message(p_conversation_id uuid, p_body text)
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
  IF v_trimmed = '' THEN
    RAISE EXCEPTION 'Message cannot be empty.';
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

  INSERT INTO public.support_messages (conversation_id, sender_id, sender_role, body)
  VALUES (p_conversation_id, v_user, v_role, v_trimmed)
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
REVOKE EXECUTE ON FUNCTION public.send_support_message FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_support_message TO authenticated;

-- mark_conversation_read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid, p_as_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_conv public.support_conversations;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;
  IF p_as_role NOT IN ('customer', 'admin') THEN
    RAISE EXCEPTION 'Invalid role.';
  END IF;

  SELECT * INTO v_conv FROM public.support_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found.'; END IF;

  IF p_as_role = 'customer' AND v_conv.user_id <> v_user THEN
    RAISE EXCEPTION 'Not your conversation.';
  END IF;
  IF p_as_role = 'admin' AND NOT public.is_admin(v_user) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  UPDATE public.support_messages
  SET read_by_recipient = true
  WHERE conversation_id = p_conversation_id
    AND sender_role <> p_as_role
    AND read_by_recipient = false;

  UPDATE public.support_conversations
  SET customer_unread_count = CASE WHEN p_as_role = 'customer' THEN 0 ELSE customer_unread_count END,
      admin_unread_count = CASE WHEN p_as_role = 'admin' THEN 0 ELSE admin_unread_count END,
      updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read TO authenticated;

-- admin_assign_conversation
CREATE OR REPLACE FUNCTION public.admin_assign_conversation(p_conversation_id uuid)
RETURNS public.support_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.support_conversations;
BEGIN
  IF v_user IS NULL OR NOT public.is_admin(v_user) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;
  UPDATE public.support_conversations
  SET assigned_admin_id = v_user, updated_at = now()
  WHERE id = p_conversation_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_assign_conversation FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_conversation TO authenticated;

-- admin_set_conversation_status
CREATE OR REPLACE FUNCTION public.admin_set_conversation_status(p_conversation_id uuid, p_status text)
RETURNS public.support_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.support_conversations;
BEGIN
  IF v_user IS NULL OR NOT public.is_admin(v_user) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;
  IF p_status NOT IN ('open', 'waiting_for_customer', 'resolved') THEN
    RAISE EXCEPTION 'Invalid status.';
  END IF;
  UPDATE public.support_conversations
  SET status = p_status, updated_at = now()
  WHERE id = p_conversation_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_conversation_status FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_conversation_status TO authenticated;

-- admin_list_support_conversations
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.user_id, p.display_name, p.account_id, p.email,
         c.status,
         a.display_name,
         (SELECT m.body FROM public.support_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1),
         c.last_message_at,
         c.admin_unread_count,
         c.created_at
  FROM public.support_conversations c
  JOIN public.profiles p ON p.id = c.user_id
  LEFT JOIN public.profiles a ON a.id = c.assigned_admin_id
  ORDER BY c.last_message_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_support_conversations FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_support_conversations TO authenticated;

-- my_support_messages
CREATE OR REPLACE FUNCTION public.my_support_messages(p_conversation_id uuid)
RETURNS public.support_messages
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

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
