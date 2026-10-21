-- Auto-provisioned virtual cards for every customer.
-- One card per user (UNIQUE constraint prevents duplicates).
-- Card is created automatically by trigger when a profile is inserted.
-- No real card numbers/CVVs are stored — only a provider-agnostic reference and status.
-- Status: 'active' (provisioned), 'pending' (awaiting provider), 'unavailable' (no provider configured).

CREATE TABLE IF NOT EXISTS public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_reference text NOT NULL UNIQUE DEFAULT ('VCD-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12))),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS cards_user_id_idx ON public.cards (user_id);

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- Customers can only see their own card
DROP POLICY IF EXISTS "select_own_card" ON public.cards;
CREATE POLICY "select_own_card"
  ON public.cards FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No direct INSERT/UPDATE/DELETE from client — provisioning is server-side via trigger/function
REVOKE ALL ON TABLE public.cards FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cards FROM authenticated;
GRANT SELECT ON TABLE public.cards TO authenticated;

-- Auto-provision a card when a profile is created (i.e. on signup)
CREATE OR REPLACE FUNCTION public.handle_new_card()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cards (user_id, status)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_card() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_card();

-- Provisioning function: simulates a provider call and sets status.
-- In production this would call the card issuer's API server-side.
CREATE OR REPLACE FUNCTION public.provision_my_card()
RETURNS public.cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_card public.cards;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  SELECT * INTO v_card FROM public.cards WHERE user_id = v_user;
  IF NOT FOUND THEN
    INSERT INTO public.cards (user_id, status) VALUES (v_user, 'pending')
    RETURNING * INTO v_card;
  END IF;

  -- If no external provider is configured, mark as 'active' (provisioned locally).
  -- When a real provider is integrated, this function would call the issuer API
  -- and set status based on the provider response.
  IF v_card.status = 'pending' THEN
    UPDATE public.cards SET status = 'active', updated_at = now()
    WHERE id = v_card.id RETURNING * INTO v_card;
  END IF;

  RETURN v_card;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_my_card FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_my_card TO authenticated;

-- Backfill cards for existing profiles who don't have one yet
INSERT INTO public.cards (user_id, status)
SELECT p.id, 'pending' FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;

-- Add cards table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.cards;
