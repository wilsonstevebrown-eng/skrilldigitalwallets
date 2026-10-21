/*
# Card activation requests, customer ID format, and card schema updates

## Overview
1. Adds card_activation_requests table for the activation workflow
2. Adds card_number and last4 columns to cards table for preview card numbers
3. Adds request_card_activation function (prevents duplicate pending requests)
4. Adds admin_review_card_activation function for approve/reject
5. Adds admin_list_card_activations function for admin dashboard
6. Changes customer ID format from BES000049 to NAME-SUFFIX (e.g. JOHN-SMITH-4827)
7. Backfills existing profiles with new-format account_ids
8. Updates handle_new_user trigger to generate new-format IDs

## New Tables
- card_activation_requests: tracks customer requests to activate their card

## Modified Tables
- cards: adds card_number (text) for preview number, last4 (text)

## Security
- RLS on card_activation_requests: customers can SELECT their own only
- Activation requests via SECURITY DEFINER function
- Admin review via SECURITY DEFINER function with is_admin check
*/

-- Add card_number and last4 to cards table
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS card_number text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS last4 text;

-- Generate a preview card number (clearly test format: 4000-XXXX-XXXX-XXXX)
CREATE OR REPLACE FUNCTION public.generate_preview_card_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT '4000-' || 
         substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
         substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
         substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
$$;

REVOKE EXECUTE ON FUNCTION public.generate_preview_card_number FROM PUBLIC, anon, authenticated;

-- Update the card provisioning trigger to also set the preview number
CREATE OR REPLACE FUNCTION public.handle_new_card()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number text;
BEGIN
  v_number := public.generate_preview_card_number();
  INSERT INTO public.cards (user_id, status, card_number, last4)
  VALUES (NEW.id, 'pending', v_number, right(v_number, 4))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_card() FROM PUBLIC, anon, authenticated;

-- Backfill preview numbers for existing cards that don't have one
UPDATE public.cards 
SET card_number = public.generate_preview_card_number(),
    last4 = right(card_number, 4)
WHERE card_number IS NULL;

-- Create card_activation_requests table
CREATE TABLE IF NOT EXISTS public.card_activation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_message text,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS card_activation_user_idx ON public.card_activation_requests (user_id);
CREATE INDEX IF NOT EXISTS card_activation_status_idx ON public.card_activation_requests (status);

ALTER TABLE public.card_activation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_activation_requests" ON public.card_activation_requests;
CREATE POLICY "select_own_activation_requests"
  ON public.card_activation_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.card_activation_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.card_activation_requests FROM authenticated;
GRANT SELECT ON TABLE public.card_activation_requests TO authenticated;

-- Customer function: request card activation (prevents duplicates)
CREATE OR REPLACE FUNCTION public.request_card_activation()
RETURNS public.card_activation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_card public.cards;
  v_existing public.card_activation_requests;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  SELECT * INTO v_card FROM public.cards WHERE user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No card found. Please contact support.';
  END IF;

  SELECT * INTO v_existing FROM public.card_activation_requests
  WHERE user_id = v_user AND status IN ('pending', 'approved')
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.card_activation_requests (user_id, card_id, status)
  VALUES (v_user, v_card.id, 'pending')
  RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_card_activation FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_card_activation TO authenticated;

-- Admin function: list all card activation requests
CREATE OR REPLACE FUNCTION public.admin_list_card_activations()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  card_id uuid,
  customer_name text,
  customer_email text,
  customer_account_id text,
  card_number text,
  last4 text,
  status text,
  admin_message text,
  created_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id, r.user_id, r.card_id,
    p.display_name AS customer_name,
    au.email AS customer_email,
    p.account_id AS customer_account_id,
    c.card_number,
    c.last4,
    r.status,
    r.admin_message,
    r.created_at,
    r.reviewed_at
  FROM public.card_activation_requests r
  JOIN public.profiles p ON p.id = r.user_id
  JOIN auth.users au ON au.id = r.user_id
  JOIN public.cards c ON c.id = r.card_id
  WHERE public.is_admin(auth.uid())
  ORDER BY r.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_card_activations FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_card_activations TO authenticated;

-- Admin function: approve or reject a card activation request
CREATE OR REPLACE FUNCTION public.admin_review_card_activation(
  p_request_id uuid,
  p_action text,
  p_message text DEFAULT NULL
)
RETURNS public.card_activation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_request public.card_activation_requests;
BEGIN
  IF NOT public.is_admin(v_admin) THEN
    RAISE EXCEPTION 'Unauthorized. Admin access required.';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action. Use approve or reject.';
  END IF;

  SELECT * INTO v_request FROM public.card_activation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activation request not found.';
  END IF;

  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION 'This request has already been reviewed.';
  END IF;

  UPDATE public.card_activation_requests
  SET status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      admin_message = p_message,
      reviewed_by = v_admin,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF p_action = 'approve' THEN
    UPDATE public.cards SET status = 'active', updated_at = now()
    WHERE id = v_request.card_id;
  END IF;

  RETURN v_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_card_activation FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_card_activation TO authenticated;

-- ========== Customer ID format change ==========

CREATE OR REPLACE FUNCTION public.generate_account_id(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name_part text;
  v_suffix text;
  v_result text;
  v_attempts int := 0;
BEGIN
  v_name_part := upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_name_part := trim(both '-' from v_name_part);
  IF v_name_part = '' THEN
    v_name_part := 'USER';
  END IF;

  LOOP
    v_suffix := lpad((floor(random() * 10000))::text, 4, '0');
    v_result := v_name_part || '-' || v_suffix;
    
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_id = v_result) THEN
      RETURN v_result;
    END IF;

    v_attempts := v_attempts + 1;
    IF v_attempts > 100 THEN
      v_suffix := lpad((floor(random() * 1000000))::text, 6, '0');
      v_result := v_name_part || '-' || v_suffix;
      RETURN v_result;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_account_id FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_account_id TO authenticated;

-- Backfill existing profiles with new-format account_ids
DO $$
DECLARE
  r record;
  v_new_id text;
BEGIN
  FOR r IN SELECT id, display_name, account_id FROM public.profiles ORDER BY created_at LOOP
    IF r.account_id LIKE 'BES%' THEN
      v_new_id := public.generate_account_id(r.display_name);
      UPDATE public.profiles SET account_id = v_new_id WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Update the handle_new_user trigger to use the new format
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, account_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    public.generate_account_id(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Drop the old default on account_id since we now generate it in the trigger
ALTER TABLE public.profiles ALTER COLUMN account_id DROP DEFAULT;
