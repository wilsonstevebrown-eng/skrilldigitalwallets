/*
# Add transfers, requests, expanded withdrawal methods, and supporting functions

1. New table: transfers
- Records money transfers between registered users.
- `id`, `from_user_id`, `to_user_id`, `amount`, `memo`, `reference`, `status`, `created_at`.
- `reference`: unique human-readable transaction reference like `TRF-XXXXXXXX`.
- `status`: 'completed' (normal transfers complete instantly).
- RLS: owner-scoped SELECT for both sender and recipient.

2. New table: money_requests
- Records requests for money between users.
- `id`, `from_user_id` (requester), `to_user_id` (requested-from), `amount`, `memo`, `status`, `created_at`, `updated_at`.
- `status`: 'pending', 'approved', 'rejected', 'cancelled'.
- RLS: both parties can SELECT; only requester can insert/cancel.
- On approval: debits the requested-from user, credits the requester, creates transactions for both, marks status 'approved'.

3. Modified table: withdrawal_requests
- Expands `payment_method` CHECK to include 10 methods.
- Adds `memo` column for optional narration.
- Adds `reference` column for unique withdrawal reference like `WDR-XXXXXXXX`.
- Adds `destination_details` jsonb column for structured destination data (bank name, account number, etc.).

4. New SECURITY DEFINER functions
- `process_transfer(p_to_identifier text, p_amount numeric, p_memo text)`: validates recipient by email or account_id, checks sender balance, debits sender, credits recipient, creates transactions + transfer record. Returns transfer details.
- `lookup_user(p_identifier text)`: looks up a user by email or account_id, returns display_name + account_id (for transfer confirmation screen). Does NOT reveal balance or other sensitive info.
- `approve_money_request(p_request uuid)`: approves a money request — debits the requested-from user, credits the requester, creates transactions, marks approved. Called by the person being requested FROM.
- `reject_money_request(p_request uuid)`: rejects a money request. Called by the person being requested FROM.
- `cancel_money_request(p_request uuid)`: cancels a money request. Called by the requester.
- `admin_list_transfers()`: returns all transfers with user info. Admin-only.
- `admin_list_money_requests()`: returns all money requests with user info. Admin-only.

5. Security
- All new tables have RLS enabled.
- All functions are SECURITY DEFINER, SET search_path = public.
- Balance changes only happen inside SECURITY DEFINER functions (never client-writable).
- REVOKE EXECUTE from anon + PUBLIC on all functions; GRANT to authenticated.
- All functions check authorization via auth.uid().
- Qualified column references (public.profiles.id etc.) to avoid PL/pgSQL ambiguity.

6. Important notes
- Transfer and request functions validate amounts (> 0, <= 300000).
- Transfer prevents self-transfers and insufficient balance.
- Money request approval checks sufficient balance of the requested-from user.
- Duplicate prevention: transfer reference is unique; request status transitions are guarded.
- No data is lost; all changes are additive.
*/

-- ============================================================
-- 1. TRANSFERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 300000),
  memo text NOT NULL DEFAULT '',
  reference text NOT NULL UNIQUE DEFAULT ('TRF-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transfers_from_created_idx ON public.transfers (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_to_created_idx ON public.transfers (to_user_id, created_at DESC);

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transfers" ON public.transfers;
CREATE POLICY "Users can view own transfers"
  ON public.transfers FOR SELECT
  TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

REVOKE ALL ON TABLE public.transfers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transfers FROM authenticated;
GRANT SELECT ON TABLE public.transfers TO authenticated;

-- ============================================================
-- 2. MONEY_REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.money_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 300000),
  memo text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS money_requests_from_created_idx ON public.money_requests (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS money_requests_to_created_idx ON public.money_requests (to_user_id, created_at DESC);

ALTER TABLE public.money_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own money_requests" ON public.money_requests;
CREATE POLICY "Users can view own money_requests"
  ON public.money_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

DROP POLICY IF EXISTS "Users can create own money_requests" ON public.money_requests;
CREATE POLICY "Users can create own money_requests"
  ON public.money_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = from_user_id);

DROP POLICY IF EXISTS "Users can update own money_requests" ON public.money_requests;
CREATE POLICY "Users can update own money_requests"
  ON public.money_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = from_user_id)
  WITH CHECK (auth.uid() = from_user_id);

REVOKE ALL ON TABLE public.money_requests FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.money_requests FROM authenticated;
GRANT SELECT ON TABLE public.money_requests TO authenticated;
GRANT INSERT (to_user_id, amount, memo) ON TABLE public.money_requests TO authenticated;

-- ============================================================
-- 3. EXPAND WITHDRAWAL_REQUESTS
-- ============================================================
ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_payment_method_check;

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'bank_transfer'
  CHECK (payment_method IN ('wire_transfer', 'cryptocurrency', 'paypal', 'cashapp', 'neteller', 'revolut', 'venmo', 'zelle', 'stripe', 'bank_transfer'));

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS memo text NOT NULL DEFAULT '';

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT ('WDR-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)));

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS destination_details jsonb;

-- Make reference unique (only for new rows; existing rows already got defaults)
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_reference_idx ON public.withdrawal_requests (reference);

-- Update insert grants to include new columns
REVOKE INSERT ON TABLE public.withdrawal_requests FROM authenticated;
GRANT INSERT (amount, payment_method, destination, memo) ON TABLE public.withdrawal_requests TO authenticated;

-- ============================================================
-- 4. LOOKUP_USER FUNCTION (for transfer confirmation)
-- ============================================================
CREATE OR REPLACE FUNCTION public.lookup_user(p_identifier text)
RETURNS TABLE (id uuid, display_name text, account_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT public.profiles.id, public.profiles.display_name, public.profiles.account_id
    FROM public.profiles
    WHERE public.profiles.email = lower(trim(p_identifier))
       OR public.profiles.account_id = upper(trim(p_identifier))
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_user FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_user TO authenticated;

-- ============================================================
-- 5. PROCESS_TRANSFER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_transfer(p_to_identifier text, p_amount numeric, p_memo text)
RETURNS TABLE (reference text, amount numeric, to_name text, to_account_id text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_recipient RECORD;
  v_sender_balance numeric;
  v_ref text;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 300000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  -- Look up recipient
  SELECT public.profiles.id, public.profiles.display_name, public.profiles.account_id, public.profiles.balance
    INTO v_recipient
    FROM public.profiles
    WHERE public.profiles.email = lower(trim(p_to_identifier))
       OR public.profiles.account_id = upper(trim(p_to_identifier))
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;

  -- Prevent self-transfer
  IF v_recipient.id = v_sender_id THEN
    RAISE EXCEPTION 'Cannot transfer to yourself';
  END IF;

  -- Check sender balance
  SELECT public.profiles.balance INTO v_sender_balance
    FROM public.profiles WHERE public.profiles.id = v_sender_id;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender account not found';
  END IF;

  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Generate reference
  v_ref := 'TRF-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  -- Debit sender
  UPDATE public.profiles SET balance = balance - p_amount, updated_at = now()
    WHERE public.profiles.id = v_sender_id;

  -- Credit recipient
  UPDATE public.profiles SET balance = balance + p_amount, updated_at = now()
    WHERE public.profiles.id = v_recipient.id;

  -- Record transfer
  INSERT INTO public.transfers (from_user_id, to_user_id, amount, memo, reference)
    VALUES (v_sender_id, v_recipient.id, p_amount, COALESCE(NULLIF(p_memo, ''), ''), v_ref);

  -- Record transactions for both parties
  INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (v_sender_id, 'debit', p_amount, 'Transfer to ' || v_recipient.display_name || ' (' || v_recipient.account_id || ')');

  INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (v_recipient.id, 'credit', p_amount, 'Transfer from ' || (SELECT public.profiles.display_name FROM public.profiles WHERE public.profiles.id = v_sender_id));

  RETURN QUERY
    SELECT v_ref, p_amount, v_recipient.display_name, v_recipient.account_id, now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_transfer FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_transfer TO authenticated;

-- ============================================================
-- 6. MONEY REQUEST FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_money_request(p_request uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.money_requests%ROWTYPE;
  v_payer_balance numeric;
  v_requester_name text;
BEGIN
  SELECT * INTO v_req FROM public.money_requests WHERE public.money_requests.id = p_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Only the person being requested FROM can approve
  IF v_req.to_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending';
  END IF;

  -- Check payer has sufficient balance
  SELECT public.profiles.balance INTO v_payer_balance
    FROM public.profiles WHERE public.profiles.id = v_req.to_user_id;

  IF v_payer_balance IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_payer_balance < v_req.amount THEN
    RAISE EXCEPTION 'Insufficient balance to approve this request';
  END IF;

  -- Get requester name for transaction description
  SELECT public.profiles.display_name INTO v_requester_name
    FROM public.profiles WHERE public.profiles.id = v_req.from_user_id;

  -- Debit the payer (person being requested from)
  UPDATE public.profiles SET balance = balance - v_req.amount, updated_at = now()
    WHERE public.profiles.id = v_req.to_user_id;

  -- Credit the requester
  UPDATE public.profiles SET balance = balance + v_req.amount, updated_at = now()
    WHERE public.profiles.id = v_req.from_user_id;

  -- Mark request approved
  UPDATE public.money_requests SET status = 'approved', updated_at = now()
    WHERE public.money_requests.id = p_request;

  -- Record transactions for both parties
  INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (v_req.to_user_id, 'debit', v_req.amount, 'Request paid to ' || v_requester_name);

  INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (v_req.from_user_id, 'credit', v_req.amount, 'Request received from ' || (SELECT public.profiles.display_name FROM public.profiles WHERE public.profiles.id = v_req.to_user_id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_money_request FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_money_request TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_money_request(p_request uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.money_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.money_requests WHERE public.money_requests.id = p_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Only the person being requested FROM can reject
  IF v_req.to_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending';
  END IF;

  UPDATE public.money_requests SET status = 'rejected', updated_at = now()
    WHERE public.money_requests.id = p_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_money_request FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_money_request TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_money_request(p_request uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.money_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.money_requests WHERE public.money_requests.id = p_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Only the requester can cancel
  IF v_req.from_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending';
  END IF;

  UPDATE public.money_requests SET status = 'cancelled', updated_at = now()
    WHERE public.money_requests.id = p_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_money_request FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_money_request TO authenticated;

-- ============================================================
-- 7. ADMIN LIST TRANSFERS + MONEY REQUESTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_transfers()
RETURNS TABLE (
  id uuid, from_user_id uuid, to_user_id uuid, amount numeric, memo text,
  reference text, status text, created_at timestamptz,
  from_name text, from_email text, from_account_id text,
  to_name text, to_email text, to_account_id text
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
    SELECT t.id, t.from_user_id, t.to_user_id, t.amount, t.memo, t.reference, t.status, t.created_at,
           pf.display_name, pf.email, pf.account_id,
           pt.display_name, pt.email, pt.account_id
    FROM public.transfers t
    JOIN public.profiles pf ON pf.id = t.from_user_id
    JOIN public.profiles pt ON pt.id = t.to_user_id
    ORDER BY t.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_transfers FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_transfers TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_money_requests()
RETURNS TABLE (
  id uuid, from_user_id uuid, to_user_id uuid, amount numeric, memo text,
  status text, created_at timestamptz, updated_at timestamptz,
  from_name text, from_email text, from_account_id text,
  to_name text, to_email text, to_account_id text
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
    SELECT mr.id, mr.from_user_id, mr.to_user_id, mr.amount, mr.memo, mr.status, mr.created_at, mr.updated_at,
           pf.display_name, pf.email, pf.account_id,
           pt.display_name, pt.email, pt.account_id
    FROM public.money_requests mr
    JOIN public.profiles pf ON pf.id = mr.from_user_id
    JOIN public.profiles pt ON pt.id = mr.to_user_id
    ORDER BY mr.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_money_requests FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_money_requests TO authenticated;
