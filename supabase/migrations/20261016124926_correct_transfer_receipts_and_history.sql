/*
# Correct transfer receipts, history, and duplicate protection

1. Problem
- The frontend treated a table-valued RPC response array as a single object, causing blank or inaccurate reference, amount, recipient, and timestamp fields.
- Recipient lookup returned only name and Account ID, not email.
- Transfer history returned only IDs and partial fields, so it could not reliably display both parties, memo, fee, or status.
- A unique reference alone did not protect against a repeated client request creating a second transfer.

2. Changes
- Add `fee` to transfers with an explicit zero default because this wallet currently charges no transfer fee.
- Add nullable `idempotency_key` with a unique index for safe client retries.
- Add `lookup_transfer_recipient` returning the registered recipient name, Account ID, and email.
- Add `process_transfer_v2`, which atomically processes a transfer and returns the complete authoritative receipt: transfer ID, sender details, recipient details, exact amount, memo, reference, fee, status, and database timestamp.
- Add `list_my_transfer_receipts`, which returns complete transfer details only when the signed-in user is the sender or recipient.

3. Security
- New functions are SECURITY DEFINER with a fixed search path.
- Receipt history is restricted to the authenticated participant.
- Balance changes remain inside one atomic database function.
- No existing rows are deleted or modified; existing transfers receive the zero-fee default when read.

4. Important behavior
- The transfer amount and memo come from the processed database row, not from display-only frontend state.
- The same idempotency key returns the original receipt instead of processing a second transfer.
- Transfer status is read from the transfer record and is currently `completed` for successful transfers.
*/

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS fee numeric(14, 2) NOT NULL DEFAULT 0.00
  CHECK (fee >= 0);

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS transfers_sender_idempotency_idx
  ON public.transfers (from_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.lookup_transfer_recipient(p_identifier text)
RETURNS TABLE (id uuid, display_name text, account_id text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.account_id, p.email
  FROM public.profiles p
  WHERE lower(p.email) = lower(trim(p_identifier))
     OR upper(p.account_id) = upper(trim(p_identifier))
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_transfer_recipient FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_transfer_recipient TO authenticated;

CREATE OR REPLACE FUNCTION public.process_transfer_v2(
  p_to_identifier text,
  p_amount numeric,
  p_memo text,
  p_idempotency_key uuid
)
RETURNS TABLE (
  transfer_id uuid,
  sender_name text,
  sender_email text,
  sender_account_id text,
  recipient_name text,
  recipient_email text,
  recipient_account_id text,
  amount numeric,
  memo text,
  reference text,
  fee numeric,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_recipient_id uuid;
  v_transfer_id uuid;
  v_ref text;
  v_created_at timestamptz;
  v_memo text := COALESCE(NULLIF(trim(p_memo), ''), '');
  v_fee numeric := 0.00;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to transfer money.';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Transfer request identifier is required.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 300000 THEN
    RAISE EXCEPTION 'Invalid amount. Amount must be greater than zero and at most 300000.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transfers t
    WHERE t.from_user_id = v_sender_id AND t.idempotency_key = p_idempotency_key
  ) THEN
    RETURN QUERY
      SELECT t.id, sf.display_name, sf.email, sf.account_id,
             st.display_name, st.email, st.account_id,
             t.amount, t.memo, t.reference, t.fee, t.status, t.created_at
      FROM public.transfers t
      JOIN public.profiles sf ON sf.id = t.from_user_id
      JOIN public.profiles st ON st.id = t.to_user_id
      WHERE t.from_user_id = v_sender_id AND t.idempotency_key = p_idempotency_key;
    RETURN;
  END IF;

  SELECT p.id INTO v_recipient_id
  FROM public.profiles p
  WHERE lower(p.email) = lower(trim(p_to_identifier))
     OR upper(p.account_id) = upper(trim(p_to_identifier))
  LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'Recipient not found. No registered user with that email or Account ID.';
  END IF;
  IF v_recipient_id = v_sender_id THEN
    RAISE EXCEPTION 'You cannot transfer money to yourself.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_sender_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_sender_id) THEN
    RAISE EXCEPTION 'Sender account not found.';
  END IF;
  IF (SELECT balance FROM public.profiles WHERE id = v_sender_id) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Your available balance is %.', (SELECT balance FROM public.profiles WHERE id = v_sender_id);
  END IF;

  v_transfer_id := gen_random_uuid();
  v_ref := 'TRF-' || upper(replace(gen_random_uuid()::text, '-', ''));
  v_created_at := now();

  UPDATE public.profiles SET balance = balance - p_amount, updated_at = now() WHERE id = v_sender_id;
  UPDATE public.profiles SET balance = balance + p_amount, updated_at = now() WHERE id = v_recipient_id;

  INSERT INTO public.transfers (id, from_user_id, to_user_id, amount, memo, reference, fee, idempotency_key, status, created_at)
  VALUES (v_transfer_id, v_sender_id, v_recipient_id, p_amount, v_memo, v_ref, v_fee, p_idempotency_key, 'completed', v_created_at);

  INSERT INTO public.transactions (user_id, type, amount, description)
  VALUES (v_sender_id, 'debit', p_amount, 'Transfer to ' || (SELECT display_name FROM public.profiles WHERE id = v_recipient_id) || ' - Ref: ' || v_ref);
  INSERT INTO public.transactions (user_id, type, amount, description)
  VALUES (v_recipient_id, 'credit', p_amount, 'Transfer from ' || (SELECT display_name FROM public.profiles WHERE id = v_sender_id) || ' - Ref: ' || v_ref);

  RETURN QUERY
    SELECT t.id, sf.display_name, sf.email, sf.account_id,
           st.display_name, st.email, st.account_id,
           t.amount, t.memo, t.reference, t.fee, t.status, t.created_at
    FROM public.transfers t
    JOIN public.profiles sf ON sf.id = t.from_user_id
    JOIN public.profiles st ON st.id = t.to_user_id
    WHERE t.id = v_transfer_id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY
      SELECT t.id, sf.display_name, sf.email, sf.account_id,
             st.display_name, st.email, st.account_id,
             t.amount, t.memo, t.reference, t.fee, t.status, t.created_at
      FROM public.transfers t
      JOIN public.profiles sf ON sf.id = t.from_user_id
      JOIN public.profiles st ON st.id = t.to_user_id
      WHERE t.from_user_id = v_sender_id AND t.idempotency_key = p_idempotency_key;
  WHEN OTHERS THEN
    RAISE EXCEPTION '%', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_transfer_v2 FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_transfer_v2 TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_transfer_receipts()
RETURNS TABLE (
  transfer_id uuid,
  sender_name text,
  sender_email text,
  sender_account_id text,
  recipient_name text,
  recipient_email text,
  recipient_account_id text,
  amount numeric,
  memo text,
  reference text,
  fee numeric,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, sf.display_name, sf.email, sf.account_id,
         st.display_name, st.email, st.account_id,
         t.amount, t.memo, t.reference, t.fee, t.status, t.created_at
  FROM public.transfers t
  JOIN public.profiles sf ON sf.id = t.from_user_id
  JOIN public.profiles st ON st.id = t.to_user_id
  WHERE t.from_user_id = auth.uid() OR t.to_user_id = auth.uid()
  ORDER BY t.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.list_my_transfer_receipts FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_transfer_receipts TO authenticated;
