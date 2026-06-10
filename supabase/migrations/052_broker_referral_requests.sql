-- ─────────────────────────────────────────────────────────────────────────────
-- 052_broker_referral_requests.sql
-- Soft broker referral. When a buyer already has a broker / pre-approval, the
-- welcome email includes a gentle "want an intro to my go-to broker?" button.
-- Clicking it (no login) marks a request here; the agent then approves and the
-- existing broker-intro email fires. Mirrors the viewing_responses token model
-- (migration 040): possession of the token IS the auth, enforced server-side.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.broker_referral_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,
  client_id     UUID REFERENCES public.clients(id)          ON DELETE SET NULL,
  client_name   TEXT,
  client_email  TEXT,
  token         TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'offered',  -- offered | requested | sent
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS brr_agent_status_idx ON public.broker_referral_requests (agent_id, status);
CREATE INDEX IF NOT EXISTS brr_token_idx        ON public.broker_referral_requests (token);

ALTER TABLE public.broker_referral_requests ENABLE ROW LEVEL SECURITY;

-- ── Agent (authenticated) owns their rows ──────────────────────────────────
DROP POLICY IF EXISTS "brr agent all" ON public.broker_referral_requests;
CREATE POLICY "brr agent all"
  ON public.broker_referral_requests FOR ALL
  USING      (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

-- ── Anon (the client clicking the email button) — token-scoped ─────────────
-- Reuses public._dealflow_request_token() from migration 040: the token rides
-- in the X-Response-Token header and every clause matches against it.
DROP POLICY IF EXISTS "brr anon select token" ON public.broker_referral_requests;
CREATE POLICY "brr anon select token"
  ON public.broker_referral_requests FOR SELECT
  TO anon
  USING (token = public._dealflow_request_token());

DROP POLICY IF EXISTS "brr anon update token" ON public.broker_referral_requests;
CREATE POLICY "brr anon update token"
  ON public.broker_referral_requests FOR UPDATE
  TO anon
  USING      (token = public._dealflow_request_token() AND expires_at > now())
  WITH CHECK (token = public._dealflow_request_token());
