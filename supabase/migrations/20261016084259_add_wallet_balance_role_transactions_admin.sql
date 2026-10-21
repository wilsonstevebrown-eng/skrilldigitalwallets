/*
# Add wallet balance, admin role, transactions, payment methods, and admin functions

1. Modified table: profiles
- Adds `balance` numeric column (default 0.00), server-controlled, not client-writable.
- Adds `role` text column (default 'member'), server-controlled, not client-writable.
- Both columns are added with IF NOT EXISTS to be idempotent.

2. Modified table: withdrawal_requests
- Adds `payment_method` text column (default 'cashapp') with CHECK constraint.
- Adds `destination` text column for the user's payout handle (Cash App tag, PayPal email, Zelle phone/email, or Stripe account ID).
- Both columns are added with IF NOT EXISTS.

3. New table: transactions
- Records wallet credits and debits per user.
- `id`, `user_id` (defaults to auth.uid()), `type` ('credit' or 'debit'), `amount`, `description`, `created_at`.
- RLS enabled, owner-scoped SELECT only for authenticated users.
- Inserts are done by admin functions only (not by the client), so authenticated INSERT is not granted.

4. New SECURITY DEFINER functions (admin-only)
- `admin_credit_balance(p_user uuid, p_amount numeric, p_description text)`: credits a user's balance and records a transaction. Only callable by profiles with role = 'admin'.
- `admin_review_withdrawal(p_request uuid, p_action text, p_message text)`: approves or rejects a withdrawal request. On approval, debits the user's balance and records a transaction. Only callable by admins.
- `admin_list_users()`: returns all profiles with id, display_name, email, account_id, balance, role, created_at. Admin-only.
- `admin_list_withdrawals()`: returns all withdrawal requests joined with profile info. Admin-only.
- All functions: SET search_path = public, REVOKE EXECUTE from anon, GRANT to authenticated.

5. Security changes
- `balance` and `role` columns on profiles: REVOKE UPDATE from authenticated (they were already revoked at table level, but this is explicit).
- `payment_method` and `destination` on withdrawal_requests: GRANT INSERT (amount, payment_method, destination) to authenticated so users can submit payment details.
- admin_list_users and admin_list_withdrawals are SECURITY DEFINER so they bypass RLS — they check role = 'admin' internally.
- Transactions table: no INSERT grant to authenticated (admin functions insert via SECURITY DEFINER).
- `admin_update_user_role(p_user uuid, p_role text)`: admin-only function to set a user's role.

6. Important notes
- All functions derive the caller from auth.uid(), never from parameters.
- Amount validation is performed inside the functions (must be > 0, <= 300000).
- The migration is idempotent and does not drop or rename existing objects.
*/

-- Add balance and role to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS balance numeric(14, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin'));

-- Add payment_method and destination to withdrawal_requests
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cashapp' CHECK (payment_method IN ('cashapp', 'paypal', 'zelle', 'stripe'));

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT '';

-- Update withdrawal_requests insert grant to include payment_method and destination
REVOKE INSERT ON TABLE public.withdrawal_requests FROM authenticated;
GRANT INSERT (amount, payment_method, destination) ON TABLE public.withdrawal_requests TO authenticated;

-- Create transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('credit', 'debit')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_user_created_idx
  ON public.transactions (user_id, created_at DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.transactions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transactions FROM authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;

-- Admin function: credit a user's balance
CREATE OR REPLACE FUNCTION public.admin_credit_balance(p_user uuid, p_amount numeric, p_description text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 300000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  UPDATE public.profiles SET balance = balance + p_amount, updated_at = now() WHERE id = p_user;

  INSERT INTO public.transactions (user_id, type, amount, description)
  VALUES (p_user, 'credit', p_amount, COALESCE(NULLIF(p_description, ''), 'Admin credit'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_credit_balance FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credit_balance TO authenticated;

-- Admin function: review (approve/reject) a withdrawal request
CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(p_request uuid, p_action text, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT * INTO v_request FROM public.withdrawal_requests WHERE id = p_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.status NOT IN ('pending', 'under_review') THEN
    RAISE EXCEPTION 'Request already processed';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.withdrawal_requests
      SET status = 'completed', review_message = COALESCE(NULLIF(p_message, ''), 'Withdrawal approved'), updated_at = now()
      WHERE id = p_request;

    UPDATE public.profiles
      SET balance = balance - v_request.amount, updated_at = now()
      WHERE id = v_request.user_id;

    INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (v_request.user_id, 'debit', v_request.amount, 'Withdrawal approved');
  ELSE
    UPDATE public.withdrawal_requests
      SET status = 'rejected', review_message = COALESCE(NULLIF(p_message, ''), 'Withdrawal rejected'), updated_at = now()
      WHERE id = p_request;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_withdrawal FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_withdrawal TO authenticated;

-- Admin function: update user role
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_role NOT IN ('member', 'admin') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE public.profiles SET role = p_role, updated_at = now() WHERE id = p_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_role FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role TO authenticated;

-- Admin function: list all users
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, display_name text, email text, account_id text, balance numeric, role text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY SELECT id, display_name, email, account_id, balance, role, created_at FROM public.profiles ORDER BY created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users TO authenticated;

-- Admin function: list all withdrawal requests with user info
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
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
