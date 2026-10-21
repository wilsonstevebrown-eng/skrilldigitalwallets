/*
# Create transparent withdrawal requests

1. New table
- `withdrawal_requests`: stores withdrawal requests submitted by signed-in users for support review.

2. New columns
- `id`: unique request identifier.
- `user_id`: authenticated owner, filled from the current session.
- `amount`: requested USD amount, required to be greater than zero and no more than 300000.
- `status`: server-controlled workflow status, starting at `pending`.
- `review_message`: clear user-facing message explaining that support review is required and no additional payment is required to submit the request.
- `created_at` and `updated_at`: request timestamps.

3. Security
- Row Level Security is enabled.
- Authenticated users can read only their own requests.
- Authenticated users can create only requests owned by their current session.
- Update and delete policies exist for ownership checks, but client update and delete privileges are revoked so users cannot change status or remove the audit record.
- Anonymous users have no access.

4. Important notes
- The browser submits only the amount; ownership, status, review message, and timestamps are assigned by the database.
- No fee, payment, or release charge is represented by this table or required by the request flow.
- The migration is idempotent and does not remove or alter existing user data.
*/

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 300000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'completed', 'rejected')),
  review_message text NOT NULL DEFAULT 'Support will review this request. No additional payment is required to submit it.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS withdrawal_requests_user_created_idx
  ON public.withdrawal_requests (user_id, created_at DESC);

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Users can view own withdrawal requests"
  ON public.withdrawal_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Users can create own withdrawal requests"
  ON public.withdrawal_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Users can update own withdrawal requests"
  ON public.withdrawal_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Users can delete own withdrawal requests"
  ON public.withdrawal_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.withdrawal_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.withdrawal_requests FROM authenticated;
GRANT SELECT ON TABLE public.withdrawal_requests TO authenticated;
GRANT INSERT (amount) ON TABLE public.withdrawal_requests TO authenticated;
