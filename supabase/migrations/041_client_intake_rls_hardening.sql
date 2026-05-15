-- Maxwell DealFlow — Migration 041
-- Phase 2.A PR #3 — security/client-intake-rls
--
-- Closes AUDIT_REPORT.md §1.1.4 (P0 #4):
--
--   The four client_intake policies set up by migration 007 used
--   USING (auth.uid() IS NOT NULL). That means any authenticated user can
--   read/update/delete every client_intake row across the project. Today
--   there is one agent so the bug is dormant — the day a second brokerage
--   or agent is provisioned they walk straight into Maxwell's leads.
--
-- Fix shape:
--   1. Bake the single canonical agent's UUID into an IMMUTABLE helper at
--      migration time. We use a helper (rather than literal UUIDs sprinkled
--      across the migration) so a future multi-tenant migration can swap the
--      whole resolution strategy in one place — e.g. look the agent up by an
--      X-Intake-Agent header set on the intake form's request.
--   2. Add agent_id column to client_intake, backfill historical rows, set
--      NOT NULL, set DEFAULT to the helper's output. anon INSERTs from
--      intake.html / seller-intake.html keep working unchanged — they
--      submit no agent_id and the default fills it.
--   3. Replace the four broken policies. anon INSERT is locked to the
--      canonical agent_id (no spoofing other agents' buckets); authenticated
--      SELECT/UPDATE/DELETE all bind to auth.uid() = agent_id.
--
-- No client-side changes. intake.html and seller-intake.html submit no
-- agent_id today and that continues to work via the DB DEFAULT.

-- ============================================================
-- 1. Helper: hardcoded canonical agent UUID for single-tenant deployment
-- ============================================================
-- IMMUTABLE so it can sit inside a column DEFAULT and so the value never
-- drifts when rows are added or removed from public.agents. When multi-tenant
-- lands, a future migration redefines this function (e.g. to pull from a
-- request header) without having to touch every policy.
--
-- Resolution is pinned by email and reads from auth.users (NOT public.agents).
-- Two reasons:
--   1. public.agents has two rows for Maxwell. One is an orphan UUID that
--      doesn't correspond to any auth.users row — its FK to auth.users would
--      blow up the backfill.
--   2. agent_id REFERENCES auth.users(id), so the source of truth is
--      auth.users by definition. Reading from public.agents and hoping the
--      ids match was the bug.
DO $$
DECLARE
  v_agent_id uuid;
  v_canonical_email constant text := 'maxwelldelali22@gmail.com';
BEGIN
  SELECT id INTO v_agent_id
    FROM auth.users
   WHERE lower(email) = lower(v_canonical_email)
   LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION
      'No row in auth.users with email %. Confirm the canonical agent has '
      'logged in at least once (creating the auth.users row) before '
      're-running this migration.',
      v_canonical_email;
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public._dealflow_default_intake_agent()
    RETURNS uuid
    LANGUAGE sql
    IMMUTABLE
    AS $body$ SELECT %L::uuid $body$;
  $f$, v_agent_id);
END
$$;

REVOKE EXECUTE ON FUNCTION public._dealflow_default_intake_agent() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._dealflow_default_intake_agent() TO anon, authenticated;

-- ============================================================
-- 2. agent_id column + backfill + default + NOT NULL
-- ============================================================
ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.client_intake
   SET agent_id = public._dealflow_default_intake_agent()
 WHERE agent_id IS NULL;

ALTER TABLE public.client_intake
  ALTER COLUMN agent_id SET DEFAULT public._dealflow_default_intake_agent();

ALTER TABLE public.client_intake
  ALTER COLUMN agent_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS client_intake_agent_idx ON public.client_intake (agent_id);

-- ============================================================
-- 3. Replace the four broken policies
-- ============================================================
DROP POLICY IF EXISTS "intake_insert_public"      ON public.client_intake;
DROP POLICY IF EXISTS "intake_read_own"           ON public.client_intake;
DROP POLICY IF EXISTS "intake_update_own"         ON public.client_intake;
DROP POLICY IF EXISTS "intake_delete_own"         ON public.client_intake;
DROP POLICY IF EXISTS "intake_insert_anon"        ON public.client_intake;
DROP POLICY IF EXISTS "intake_read_own_agent"     ON public.client_intake;
DROP POLICY IF EXISTS "intake_update_own_agent"   ON public.client_intake;
DROP POLICY IF EXISTS "intake_delete_own_agent"   ON public.client_intake;

-- anon INSERT — agent_id must match the canonical default. The DB DEFAULT
-- fills it automatically when intake.html / seller-intake.html omit it; an
-- attacker can't spoof a different agent_id because WITH CHECK rejects it.
CREATE POLICY "intake_insert_anon"
  ON public.client_intake
  FOR INSERT
  TO anon
  WITH CHECK (
    agent_id = public._dealflow_default_intake_agent()
  );

-- authenticated agent SELECT — only your own leads.
CREATE POLICY "intake_read_own_agent"
  ON public.client_intake
  FOR SELECT
  TO authenticated
  USING (agent_id = auth.uid());

-- authenticated agent UPDATE — same scope, plus WITH CHECK so you can't
-- re-assign a row to a different agent during update.
CREATE POLICY "intake_update_own_agent"
  ON public.client_intake
  FOR UPDATE
  TO authenticated
  USING      (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

-- authenticated agent DELETE — only your own.
CREATE POLICY "intake_delete_own_agent"
  ON public.client_intake
  FOR DELETE
  TO authenticated
  USING (agent_id = auth.uid());

-- ============================================================
-- 4. Smoke tests (run after applying)
-- ============================================================
-- a) Backfill landed:
--      SELECT count(*) FROM client_intake WHERE agent_id IS NULL;   -- expect 0
--
-- b) Default works (as anon, simulating the intake form):
--      curl -X POST $URL/rest/v1/client_intake \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -H "Prefer: return=representation" \
--        -d '{"full_name":"Smoke Test","email":"smoke@test.com"}'
--      → 201, returned row has agent_id = canonical agent.
--
-- c) Spoof attempt blocked:
--      curl -X POST $URL/rest/v1/client_intake \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -d '{"full_name":"Spoof","email":"x@y.com","agent_id":"00000000-0000-0000-0000-000000000000"}'
--      → 403 / row violates WITH CHECK.
--
-- d) Authenticated agent (as Maxwell) reads only own rows:
--      SELECT count(*) FROM client_intake;
--      → equals pre-migration count (all rows backfilled to him).
--
-- e) Future second agent (simulated by signing in with a different auth user)
--    SELECT returns 0 — they can no longer see Maxwell's leads.
