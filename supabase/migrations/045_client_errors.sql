-- Maxwell DealFlow — Migration 045
-- PR #7 — obs/client-errors-table
--
-- Closes AUDIT_REPORT.md §2.3 (P1 — error visibility):
--   "There is none today. No Sentry / Bugsnag / Rollbar. No
--   console-error visibility. When setTimeout cascades silently
--   fail on a slow phone, nobody notices until Maxwell complains."
--
-- Approach (per the Phase 2 plan — "start cheap, in-system"):
--   - Authenticated agents POST their own errors to this table.
--   - Only the service-role can read. The future agent SystemTools
--     panel will read via a SECURITY DEFINER RPC; for now Maxwell
--     queries directly in the Supabase SQL editor.
--   - Nightly cleanup at 03:20 UTC purges rows older than 30 days.
--
-- We revisit in 90 days. If error volume + signal justifies a
-- third party (Sentry / PostHog), we graduate. Until then,
-- everything stays in-database.

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  url         text,
  user_agent  text,
  message     text,
  stack       text,
  context     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_errors_agent_idx
  ON public.client_errors (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_errors_created_idx
  ON public.client_errors (created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Authenticated agents can INSERT only errors attributed to themselves.
-- No SELECT/UPDATE/DELETE policies → only the postgres / service role can
-- read, edit, or remove rows. The agent app is write-only against this
-- table by design.
DROP POLICY IF EXISTS "client_errors_authenticated_insert" ON public.client_errors;
CREATE POLICY "client_errors_authenticated_insert"
  ON public.client_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (agent_id = auth.uid());

-- ============================================================
-- Nightly cleanup — keep the table size sane.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_client_errors()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.client_errors
   WHERE created_at < now() - interval '30 days';
$$;

-- Schedule at 03:20 UTC (offset from email/claude cleanups at :10 and :15).
SELECT cron.schedule(
  'client-errors-cleanup',
  '20 3 * * *',
  $$SELECT public.cleanup_client_errors();$$
);

-- ============================================================
-- Smoke tests (run as postgres in the SQL editor)
-- ============================================================
-- a) Insert as the canonical agent — should succeed:
--      SET ROLE authenticated;
--      INSERT INTO client_errors (agent_id, message, url)
--      VALUES ('fe551eb0-7d5a-4302-880f-003ac36ace07', 'manual smoke', '/');
--      RESET ROLE;
--
-- b) Anon attempt to insert — should fail with RLS:
--      SET ROLE anon;
--      INSERT INTO client_errors (message) VALUES ('spam');
--      RESET ROLE;  -- expect 42501
--
-- c) Authenticated attempt to insert someone else's agent_id — should fail:
--      SET ROLE authenticated;
--      INSERT INTO client_errors (agent_id, message)
--      VALUES ('00000000-0000-0000-0000-000000000000', 'spoof');  -- expect 42501
--      RESET ROLE;
--
-- d) Read all errors as postgres (the day-to-day debugging query):
--      SELECT created_at, message, url, agent_id
--      FROM client_errors
--      ORDER BY created_at DESC
--      LIMIT 20;
