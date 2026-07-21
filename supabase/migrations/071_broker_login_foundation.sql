-- ─────────────────────────────────────────────────────────────────────────────
-- 071_broker_login_foundation.sql
-- Financing Lane — Stage 1a: secure broker LOGIN foundation.
--
-- Lets the mortgage broker (Asare) have a REAL login (reusing the co-agent
-- invite-agent flow) that can read/update ONLY the referrals linked to him, and
-- nothing else. Every other table is already scoped `agent_id = auth.uid()`, so a
-- broker's login (a different uid) cannot read the founder's clients/deals/offers.
-- (Audited across all migrations: 42 agent-scoped policies; the two historical
-- "any authenticated user" leaks — briefings mig 037, client_intake mig 007 —
-- were already fixed in 058 and 060.)
--
-- Apply in the Supabase SQL Editor after 067-070. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Role flag: 'agent' (default, unchanged for everyone) or 'broker'.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'agent';

-- Link a referral to the broker's login so he can see it when signed in.
ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS broker_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS brr_broker_idx ON public.broker_referral_requests (broker_id);

-- The signed-in broker may read the referrals linked to him. This ADDS to the
-- existing "agent owns their rows" policy (the founder still sees his rows); it
-- does NOT widen access to anything else — only rows where broker_id = his uid.
DROP POLICY IF EXISTS "brr broker read own" ON public.broker_referral_requests;
CREATE POLICY "brr broker read own"
  ON public.broker_referral_requests FOR SELECT
  TO authenticated
  USING (broker_id = auth.uid());

-- The signed-in broker may update ONLY his linked rows (approve, snapshot, ready).
DROP POLICY IF EXISTS "brr broker update own" ON public.broker_referral_requests;
CREATE POLICY "brr broker update own"
  ON public.broker_referral_requests FOR UPDATE
  TO authenticated
  USING (broker_id = auth.uid())
  WITH CHECK (broker_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY isolation (run once Asare has a login — proves he sees only his rows):
--   -- as Asare's session, this must return ONLY his referrals:
--   SELECT count(*) FROM public.broker_referral_requests;      -- his linked ones only
--   -- as Asare's session, these must all return 0 (no access to founder data):
--   SELECT count(*) FROM public.clients;
--   SELECT count(*) FROM public.offers;
--   SELECT count(*) FROM public.client_intake;
-- ─────────────────────────────────────────────────────────────────────────────
