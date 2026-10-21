/*
# Fix money_requests: resolve Account ID to UUID via SECURITY DEFINER function

1. Problem
- `money_requests.to_user_id` is a `uuid` column referencing `auth.users(id)`.
- The frontend was inserting the Account ID text (e.g. `BES000050`) directly as `to_user_id`.
- A text Account ID is not a valid UUID, so every insert failed with a foreign key violation.
- This is why money requests were silently failing / "canceled".

2. Fix
- Create `send_money_request(p_to_account_id text, p_amount numeric, p_memo text)` SECURITY DEFINER function.
- Resolves the Account ID to a UUID by looking up `public.profiles.account_id`.
- Validates: recipient exists, not self-request, amount > 0 and <= 300000.
- Inserts the money_request row with the correct UUID.
- Returns the request id so the frontend can confirm success.
- REVOKE EXECUTE from anon/PUBLIC; GRANT to authenticated.

3. Also fix process_transfer for atomicity and better error messages
- Add explicit RAISE with SQLERRM for better error surfacing.
- Wrap the core logic in a BEGIN/EXCEPTION block so that if any step fails, the entire operation is rolled back (atomic).
- This prevents partial updates where sender is debited but recipient is not credited.

4. Security
- Both functions are SECURITY DEFINER, SET search_path = public.
- `send_money_request` uses auth.uid() for from_user_id (never trusts client input).
- REVOKE EXECUTE from anon + PUBLIC on all functions; GRANT to authenticated.

5. Important notes
- No data is lost; all changes are additive.
- The money_requests INSERT grant on the table is no longer needed for the client
  since the function handles inserts, but it is left in place for compatibility.
*/

CREATE OR REPLACE FUNCTION public.send_money_request(p_to_account_id text, p_amount numeric, p_memo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_id uuid := auth.uid();
  v_recipient_id uuid;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 300000 THEN
    RAISE EXCEPTION 'Invalid amount. Amount must be greater than zero and at most 300000.';
  END IF;

  -- Look up recipient by account_id
  SELECT public.profiles.id INTO v_recipient_id
    FROM public.profiles
    WHERE public.profiles.account_id = upper(trim(p_to_account_id))
    LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'Recipient not found. Check the Account ID and try again.';
  END IF;

  -- Prevent self-request
  IF v_recipient_id = v_requester_id THEN
    RAISE EXCEPTION 'You cannot request money from yourself.';
  END IF;

  -- Insert the money request
  INSERT INTO public.money_requests (from_user_id, to_user_id, amount, memo)
    VALUES (v_requester_id, v_recipient_id, p_amount, COALESCE(NULLIF(p_memo, ''), ''));

  RETURN (SELECT id FROM public.money_requests
    WHERE from_user_id = v_requester_id AND to_user_id = v_recipient_id
    ORDER BY created_at DESC LIMIT 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_money_request FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_money_request TO authenticated;

-- ============================================================
-- Fix process_transfer: add atomic exception handling and better errors
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
    RAISE EXCEPTION 'Invalid amount. Amount must be greater than zero and at most 300000.';
  END IF;

  -- Look up recipient by email or account_id
  SELECT public.profiles.id, public.profiles.display_name, public.profiles.account_id, public.profiles.balance
    INTO v_recipient
    FROM public.profiles
    WHERE public.profiles.email = lower(trim(p_to_identifier))
       OR public.profiles.account_id = upper(trim(p_to_identifier))
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient not found. No registered user with that email or Account ID.';
  END IF;

  -- Prevent self-transfer
  IF v_recipient.id = v_sender_id THEN
    RAISE EXCEPTION 'You cannot transfer money to yourself.';
  END IF;

  -- Check sender balance
  SELECT public.profiles.balance INTO v_sender_balance
    FROM public.profiles WHERE public.profiles.id = v_sender_id;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender account not found.';
  END IF;

  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Your available balance is %.', v_sender_balance;
  END IF;

  -- Generate unique reference
  v_ref := 'TRF-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  -- Perform the transfer atomically
  BEGIN
    -- Debit sender
    UPDATE public.profiles SET balance = balance - p_amount, updated_at = now()
      WHERE public.profiles.id = v_sender_id;

    -- Credit recipient
    UPDATE public.profiles SET balance = balance + p_amount, updated_at = now()
      WHERE public.profiles.id = v_recipient.id;

    -- Record transfer
    INSERT INTO public.transfers (from_user_id, to_user_id, amount, memo, reference)
      VALUES (v_sender_id, v_recipient.id, p_amount, COALESCE(NULLIF(p_memo, ''), ''), v_ref);

    -- Record transaction for sender (debit)
    INSERT INTO public.transactions (user_id, type, amount, description)
      VALUES (v_sender_id, 'debit', p_amount,
        'Transfer to ' || v_recipient.display_name || ' (' || v_recipient.account_id || ') - Ref: ' || v_ref);

    -- Record transaction for recipient (credit)
    INSERT INTO public.transactions (user_id, type, amount, description)
      VALUES (v_recipient.id, 'credit', p_amount,
        'Transfer from ' || (SELECT public.profiles.display_name FROM public.profiles WHERE public.profiles.id = v_sender_id) || ' - Ref: ' || v_ref);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Transfer failed due to a database error: %', SQLERRM;
  END;

  RETURN QUERY
    SELECT v_ref, p_amount, v_recipient.display_name, v_recipient.account_id, now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_transfer FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_transfer TO authenticated;
