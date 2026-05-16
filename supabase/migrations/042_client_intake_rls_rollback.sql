-- Maxwell DealFlow — Migration 042
-- PR #3e — rollback `security/client-intake-rls` series
--
-- Migration 041 (PR #3 / #3a / #3b / #3c / #3d) installed a stricter RLS
-- regime on client_intake that blocked all anon INSERTs in a way we
-- couldn't trace within reasonable iteration count. Symptoms:
--   - WITH CHECK (true) policy + SET ROLE anon → 42501 in SQL editor.
--   - PostgREST /rest/v1/client_intake POST as anon → 42501.
--   - Disabling RLS allows the same insert.
--   - Function returns the correct UUID when called directly as anon.
--   - No restrictive policies, no triggers other than ours, no obvious
--     cause.
--
-- Production effect: intake.html and seller-intake.html stopped accepting
-- new client submissions immediately after migration 041 applied.
--
-- This migration reverts client_intake to its pre-041 (migration 007)
-- state so production resumes working. AUDIT_REPORT.md §1.1.4 — the
-- cross-agent readability concern — is unresolved but dormant in
-- single-tenant deployment (today's state). We'll revisit with a
-- SECURITY DEFINER RPC approach in a future PR cycle.

-- ============================================================
-- 1. Drop everything from migration 041
-- ============================================================
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

DROP TRIGGER  IF EXISTS tr_client_intake_set_agent       ON public.client_intake;
DROP FUNCTION IF EXISTS public._dealflow_set_intake_agent();

-- ============================================================
-- 2. Loosen the agent_id column so existing+new submissions work
-- ============================================================
-- Keep the column itself (other code might already reference it),
-- just drop the NOT NULL and DEFAULT constraints so submissions
-- with no agent_id no longer hit a constraint violation.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.client_intake ALTER COLUMN agent_id DROP DEFAULT';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER TABLE public.client_intake ALTER COLUMN agent_id DROP NOT NULL';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END
$$;

-- ============================================================
-- 3. Restore the original migration-007 policies (loose RLS)
-- ============================================================
-- Same shape and names as migration 007 created. The dormant bug from
-- AUDIT_REPORT.md §1.1.4 returns — any authenticated user sees every
-- client_intake row. Acceptable in single-tenant production while we
-- regroup on the security approach.
CREATE POLICY "intake_insert_public" ON public.client_intake
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "intake_read_own" ON public.client_intake
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "intake_update_own" ON public.client_intake
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "intake_delete_own" ON public.client_intake
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 4. Smoke-test (run after applying)
-- ============================================================
-- As anon:
--   curl -X POST $URL/rest/v1/client_intake \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H "Content-Type: application/json" \
--     -d '{"full_name":"Rollback Smoke","email":"rollback@test.com"}'
--   → 201 with row.
--
-- DELETE FROM client_intake WHERE email='rollback@test.com'; -- cleanup
