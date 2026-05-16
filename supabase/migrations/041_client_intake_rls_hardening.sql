-- Maxwell DealFlow — Migration 041
-- Phase 2.A PR #3 — security/client-intake-rls (FINAL: hardcoded UUID approach)
--
-- Closes AUDIT_REPORT.md §1.1.4 (P0 #4):
--
--   The four client_intake policies set up by migration 007 used
--   USING (auth.uid() IS NOT NULL) — meaning any authenticated user can
--   read/update/delete every row across the project. Today there is one
--   agent so the bug is dormant — the day a second agent is provisioned
--   they walk straight into Maxwell's leads.
--
-- Approach (after several iterations — see REFINEMENT_LOG.md):
--   The earlier version of this migration used an IMMUTABLE helper function
--   `_dealflow_default_intake_agent()` as the source of truth for the canonical
--   agent UUID. The function returned the right value when called directly as
--   anon, but the policy WITH CHECK clause that referenced the function failed
--   to evaluate correctly during real INSERTs — root cause unclear, possibly
--   plan-caching or function-inlining interaction with RLS. After exhausting
--   the function indirection, we ditched it: the canonical UUID is now
--   hardcoded in the column DEFAULT and policy WITH CHECK. Single place to
--   search-replace when multi-tenant lands.
--
-- The canonical agent UUID `fe551eb0-7d5a-4302-880f-003ac36ace07` is the
-- auth.users.id for `maxwelldelali22@gmail.com`. Read from auth.users (NOT
-- public.agents — that table has an orphan row with a UUID that doesn't
-- exist in auth.users and would violate the FK).

-- ============================================================
-- 1. Drop all existing policies on client_intake
-- ============================================================
-- Covers original migration-007 policies, dashboard-UI-added policies, AND
-- the function-based policies from earlier iterations of this migration.
-- Dynamic loop is safe because every legitimate policy on this table is
-- re-created below.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT polname FROM pg_policy
     WHERE polrelid = 'public.client_intake'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.client_intake', r.polname);
  END LOOP;
END
$$;

-- ============================================================
-- 2. Drop any existing column default + the now-unused helper function
-- ============================================================
-- Order matters: policies (which referenced the function) must be gone before
-- we can DROP FUNCTION. Step 1 already handled them.
DO $$
BEGIN
  -- column may not have a default yet on a fresh DB; be defensive
  BEGIN
    EXECUTE 'ALTER TABLE public.client_intake ALTER COLUMN agent_id DROP DEFAULT';
  EXCEPTION
    WHEN undefined_column THEN NULL;   -- agent_id column doesn't exist yet
    WHEN OTHERS THEN NULL;             -- no default set
  END;
END
$$;

DROP FUNCTION IF EXISTS public._dealflow_default_intake_agent();

-- ============================================================
-- 3. Schema: agent_id column with literal default + NOT NULL
-- ============================================================
ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill any historical rows (idempotent: only rows without an owner).
UPDATE public.client_intake
   SET agent_id = 'fe551eb0-7d5a-4302-880f-003ac36ace07'::uuid
 WHERE agent_id IS NULL;

ALTER TABLE public.client_intake
  ALTER COLUMN agent_id SET DEFAULT 'fe551eb0-7d5a-4302-880f-003ac36ace07'::uuid;
ALTER TABLE public.client_intake
  ALTER COLUMN agent_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS client_intake_agent_idx ON public.client_intake (agent_id);

-- ============================================================
-- 4. BEFORE INSERT trigger — fill agent_id when caller omits it
-- ============================================================
-- PostgREST sends missing columns as NULL (not as DEFAULT) unless the
-- caller sets `Prefer: missing=default`. The production intake forms
-- (intake.html, seller-intake.html) submit without agent_id and without
-- that header. Without this trigger they'd hit either the NOT NULL
-- constraint or the RLS WITH CHECK.
--
-- The trigger runs BEFORE INSERT, so it populates NEW.agent_id before
-- the NOT NULL check and before RLS evaluates. Direct anon spoof
-- attempts (caller supplied a different UUID) leave NEW.agent_id
-- untouched and the policy WITH CHECK rejects them — security preserved.
CREATE OR REPLACE FUNCTION public._dealflow_set_intake_agent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.agent_id IS NULL THEN
    NEW.agent_id := 'fe551eb0-7d5a-4302-880f-003ac36ace07'::uuid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_client_intake_set_agent ON public.client_intake;
CREATE TRIGGER tr_client_intake_set_agent
  BEFORE INSERT ON public.client_intake
  FOR EACH ROW
  EXECUTE FUNCTION public._dealflow_set_intake_agent();

-- ============================================================
-- 5. Policies — literal UUID throughout, no function indirection
-- ============================================================

-- anon INSERT: agent_id must equal the canonical UUID. The BEFORE INSERT
-- trigger above ensures NULL-supplied agent_id is filled with this same
-- UUID before the check runs, so the production intake forms work
-- transparently. Spoof attempts (caller supplies a non-canonical UUID)
-- are rejected because the trigger leaves their value alone and WITH
-- CHECK then fails.
CREATE POLICY "intake_insert_anon"
  ON public.client_intake
  FOR INSERT
  TO anon
  WITH CHECK (
    agent_id = 'fe551eb0-7d5a-4302-880f-003ac36ace07'::uuid
  );

-- Authenticated agents read/update/delete only their own rows.
CREATE POLICY "intake_read_own_agent"
  ON public.client_intake
  FOR SELECT
  TO authenticated
  USING (agent_id = auth.uid());

CREATE POLICY "intake_update_own_agent"
  ON public.client_intake
  FOR UPDATE
  TO authenticated
  USING      (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

CREATE POLICY "intake_delete_own_agent"
  ON public.client_intake
  FOR DELETE
  TO authenticated
  USING (agent_id = auth.uid());

-- ============================================================
-- 5. Smoke tests (run separately after applying)
-- ============================================================
-- a) Backfill landed:
--      SELECT count(*) FROM client_intake WHERE agent_id IS NULL;   -- expect 0
--
-- b) anon insert with explicit canonical agent_id (the main production path):
--      curl -X POST $URL/rest/v1/client_intake \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" -H "Prefer: return=representation" \
--        -d '{"full_name":"T","email":"t@t.com","agent_id":"fe551eb0-7d5a-4302-880f-003ac36ace07"}'
--      → 201 with row.
--
-- c) anon insert with spoofed agent_id:
--      same as (b) but agent_id="00000000-0000-0000-0000-000000000000"
--      → 403 / 42501.
--
-- d) authenticated agent SELECT count equals pre-migration count.
