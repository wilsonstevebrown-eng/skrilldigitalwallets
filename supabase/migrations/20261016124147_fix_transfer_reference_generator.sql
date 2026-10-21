/*
# Fix transfer reference generation

1. Problem
- Transfers failed before processing because the database called `gen_random_bytes(integer)`.
- That function is unavailable in this Supabase database, so no balance or transaction changes were made.

2. Changes
- Replace transfer reference generation with `gen_random_uuid()`, which is already available and used by the application's UUID columns.
- Replace the withdrawal reference default with the same supported generator so withdrawal submissions do not hit the same error.
- Recreate `process_transfer` with the supported unique reference format.

3. Security and integrity
- The transfer remains a SECURITY DEFINER function available only to authenticated users.
- Balance changes remain inside one database function and roll back together if any write fails.
- No existing rows are changed or deleted.
*/

ALTER TABLE public.transfers
  ALTER COLUMN reference SET DEFAULT ('TRF-' || upper(replace(gen_random_uuid()::text, '-', '')));

ALTER TABLE public.withdrawal_requests
  ALTER COLUMN reference SET DEFAULT ('WDR-' || upper(replace(gen_random_uuid()::text, '-', '')));

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
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to transfer money.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 300000 THEN
    RAISE EXCEPTION 'Invalid amount. Amount must be greater than zero and at most 300000.';
  END IF;

  SELECT public.profiles.id, public.profiles.display_name, public.profiles.account_id
    INTO v_recipient
    FROM public.profiles
    WHERE lower(public.profiles.email) = lower(trim(p_to_identifier))
       OR upper(public.profiles.account_id) = upper(trim(p_to_identifier))
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient not found. No registered user with that email or Account ID.';
  END IF;

  IF v_recipient.id = v_sender_id THEN
    RAISE EXCEPTION 'You cannot transfer money to yourself.';
  END IF;

  SELECT public.profiles.balance
    INTO v_sender_balance
    FROM public.profiles
    WHERE public.profiles.id = v_sender_id
    FOR UPDATE;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender account not found.';
  END IF;

  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Your available balance is %.', v_sender_balance;
  END IF;

  v_ref := 'TRF-' || upper(replace(gen_random_uuid()::text, '-', ''));

  UPDATE public.profiles
    SET balance = balance - p_amount, updated_at = now()
    WHERE public.profiles.id = v_sender_id;

  UPDATE public.profiles
    SET balance = balance + p_amount, updated_at = now()
    WHERE public.profiles.id = v_recipient.id;

  INSERT INTO public.transfers (from_user_id, to_user_id, amount, memo, reference, status)
    VALUES (v_sender_id, v_recipient.id, p_amount, COALESCE(NULLIF(trim(p_memo), ''), ''), v_ref, 'completed');

  INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (
      v_sender_id,
      'debit',
      p_amount,
      'Transfer to ' || v_recipient.display_name || ' (' || v_recipient.account_id || ') - Ref: ' || v_ref
    );

  INSERT INTO public.transactions (user_id, type, amount, description)
    VALUES (
      v_recipient.id,
      'credit',
      p_amount,
      'Transfer from ' || COALESCE((SELECT public.profiles.display_name FROM public.profiles WHERE public.profiles.id = v_sender_id), 'Skrill user') || ' - Ref: ' || v_ref
    );

  RETURN QUERY
    SELECT v_ref, p_amount, v_recipient.display_name, v_recipient.account_id, now();
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION '%', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_transfer FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_transfer TO authenticated;
