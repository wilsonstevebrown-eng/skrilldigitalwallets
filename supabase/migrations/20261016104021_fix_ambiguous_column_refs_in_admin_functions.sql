/*
# Fix ambiguous column references in admin functions

All five SECURITY DEFINER admin functions referenced `id` and `role` without
table qualification inside their PL/pgSQL bodies. In the function context
Postgres cannot resolve whether `id` refers to the `profiles.id` column or
an implicit PL/pgSQL variable, raising:

  ERROR: column reference "id" is ambiguous

This silently broke every admin RPC call from the frontend:
- admin_list_users() returned nothing (admin dashboard showed no users)
- admin_list_withdrawals() returned nothing
- admin_credit_balance() failed
- admin_review_withdrawal() failed
- admin_update_user_role() failed

1. Changes
- Re-creates all five functions with fully-qualified column references
  (public.profiles.id, public.profiles.role, public.profiles.balance, etc.)
- Function signatures, return types, and permissions are unchanged.
- No data is touched; no tables or columns are altered.

2. Security
- All functions remain SECURITY DEFINER, SET search_path = public.
- REVOKE EXECUTE from anon + PUBLIC, GRANT to authenticated — same as before.
- Admin-only authorization check (role = 'admin') is unchanged in logic,
  only the column qualification changed.
*/

-- Fix: admin_credit_balance
CREATE OR REPLACE FUNCTION public.admin_credit_balance(p_user uuid, p_amount numeric, p_description text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.profiles.id = auth.uid() AND public.profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 300000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  UPDATE public.profiles SET balance = balance + p_amount, updated_at = now() WHERE public.profiles.id = p_user;

  INSERT INTO public.transactions (user_id, type, amount, description)
  VALUES (p_user, 'credit', p_amount, COALESCE(NULLIF(p_description, ''), 'Admin credit'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_credit_balance FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credit_balance TO authenticated;

-- Fix: admin_review_withdrawal
CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(p_request uuid, p_action text, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.profiles.id = auth.uid() AND public.profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT * INTO v_request FROM public.withdrawal_requests WHERE public.withdrawal_requests.id = p_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.status NOT IN ('pending', 'under_review') THEN
    RAISE EXCEPTION 'Request already processed';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.withdrawal_requests
      SET status = 'completed', review_message = COALESCE(NULLIF(p_message, ''), 'Withdrawal approved'), updated_at = now()
      WHERE public.withdrawal_requests.id = p_request;

    UPDATE public.profiles
      SET balance = balance - v_request.amount, updated_at = now()
      WHERE public.profiles.id = v_request.user_id;

    INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (v_request.user_id, 'debit', v_request.amount, 'Withdrawal approved');
  ELSE
    UPDATE public.withdrawal_requests
      SET status = 'rejected', review_message = COALESCE(NULLIF(p_message, ''), 'Withdrawal rejected'), updated_at = now()
      WHERE public.withdrawal_requests.id = p_request;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_withdrawal FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_withdrawal TO authenticated;

-- Fix: admin_update_user_role
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.profiles.id = auth.uid() AND public.profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_role NOT IN ('member', 'admin') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE public.profiles SET role = p_role, updated_at = now() WHERE public.profiles.id = p_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_role FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role TO authenticated;

-- Fix: admin_list_users
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, display_name text, email text, account_id text, balance numeric, role text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.profiles.id = auth.uid() AND public.profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT public.profiles.id, public.profiles.display_name, public.profiles.email,
           public.profiles.account_id, public.profiles.balance, public.profiles.role,
           public.profiles.created_at
    FROM public.profiles
    ORDER BY public.profiles.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users TO authenticated;

-- Fix: admin_list_withdrawals
CREATE OR REPLACE FUNCTION public.admin_list_withdrawals()
RETURNS TABLE (
  id uuid, user_id uuid, amount numeric, status text, payment_method text, destination text,
  review_message text, created_at timestamptz, updated_at timestamptz,
  display_name text, email text, account_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.profiles.id = auth.uid() AND public.profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT wr.id, wr.user_id, wr.amount, wr.status, wr.payment_method, wr.destination,
           wr.review_message, wr.created_at, wr.updated_at,
           p.display_name, p.email, p.account_id
    FROM public.withdrawal_requests wr
    JOIN public.profiles p ON p.id = wr.user_id
    ORDER BY wr.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_withdrawals FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_withdrawals TO authenticated;
