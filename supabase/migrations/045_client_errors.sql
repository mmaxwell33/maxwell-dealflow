-- Maxwell DealFlow — Migration 045
-- PR #7 — observability/client-errors
--
-- Closes AUDIT_REPORT.md §2.3:
--   The app has zero error visibility today — no Sentry, no PostHog, no
--   Supabase log table the JS writes to. When window.onerror or an
--   unhandledrejection fires on Maxwell's phone, nobody sees it until
--   he reports the symptom. We're flying without instruments.
--
-- This migration sets up the cheapest credible path: a single Postgres
-- table that the browser POSTs to from window.onerror /
-- window.onunhandledrejection / explicit App.logError() calls. Maxwell
-- reads errors via the Supabase Dashboard's table editor (which runs as
-- service role and bypasses RLS).
--
-- When error volume grows past what a single table comfortably handles,
-- graduate to Sentry (free up to 5K events/month) — but only after CSP
-- is enforceable, because Sentry's loader uses inline scripts.

CREATE TABLE IF NOT EXISTS public.client_errors (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  url          text,
  user_agent   text,
  message      text          NOT NULL,
  stack        text,
  context      jsonb,
  -- Stable per-browser-tab id so we can group errors that fired in the
  -- same session. App.logError generates this once per page-load.
  session_id   text,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_errors_agent_idx
  ON public.client_errors (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_created_idx
  ON public.client_errors (created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS — write-only for everyone, read only via service role
-- ============================================================
-- Errors are append-only from the client side. Reads happen through
-- the Supabase Dashboard (service role, bypasses RLS) so there's no
-- need for an authenticated-read policy. UPDATE/DELETE are blocked
-- for everyone — corruption-prone and not needed.

-- Authenticated agents can insert errors stamped with their own agent_id.
DROP POLICY IF EXISTS "client_errors_insert_authenticated" ON public.client_errors;
CREATE POLICY "client_errors_insert_authenticated"
  ON public.client_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (agent_id = auth.uid());

-- Anon callers (public pages: respond.html, intake.html, lock screen)
-- can insert errors with agent_id = NULL. Forward-compat: if a public
-- page ever has the agent slug in the URL, the future schema can scope
-- this further. For now anyone with the anon key can log a NULL-agent
-- error. Spam risk is low (no readable side effect from inserting).
DROP POLICY IF EXISTS "client_errors_insert_anon" ON public.client_errors;
CREATE POLICY "client_errors_insert_anon"
  ON public.client_errors
  FOR INSERT
  TO anon
  WITH CHECK (agent_id IS NULL);

-- ============================================================
-- Cleanup — keep table small
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_client_errors()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.client_errors
   WHERE created_at < now() - interval '30 days';
$$;

-- Nightly at 03:20 UTC (offset from email-rate-limit 03:10 and
-- claude-rate-limit 03:15 cleanups).
SELECT cron.schedule(
  'client-errors-cleanup',
  '20 3 * * *',
  $$SELECT public.cleanup_client_errors();$$
);

-- ============================================================
-- Smoke tests (run after applying)
-- ============================================================
-- a) Authenticated agent insert (via the agent app or a SQL editor session
--    where auth.uid() is set):
--      INSERT INTO client_errors (agent_id, message)
--        VALUES (auth.uid(), 'smoke test');
--      → 1 row inserted.
--
-- b) Authenticated agent attempting to write somebody else's agent_id:
--      INSERT INTO client_errors (agent_id, message)
--        VALUES ('00000000-0000-0000-0000-000000000000', 'spoof');
--      → 42501 / row violates RLS WITH CHECK.
--
-- c) anon insert with agent_id = NULL:
--      curl -X POST $URL/rest/v1/client_errors \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -d '{"message":"anon smoke test"}'
--      → 201 with the new row.
--
-- d) anon insert with a forged agent_id:
--      curl -X POST $URL/rest/v1/client_errors \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -d '{"agent_id":"fe551eb0-7d5a-4302-880f-003ac36ace07","message":"spoof"}'
--      → 42501.
--
-- e) Reading recent errors (run as postgres / via dashboard SQL editor):
--      SELECT id, agent_id, url, message, created_at
--        FROM client_errors
--       ORDER BY created_at DESC
--       LIMIT 50;
