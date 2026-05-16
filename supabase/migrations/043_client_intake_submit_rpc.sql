-- Maxwell DealFlow — Migration 043
-- PR #3f — security/client-intake-submit-rpc
--
-- After five iterations on policy-based RLS for client_intake, anon INSERTs
-- continued to be rejected with 42501 regardless of policy shape (function-
-- based, hardcoded literal, WITH CHECK true, even TO PUBLIC). The proxy
-- response from Supabase confirms: `proxy-status: PostgREST; error=42501`.
-- Whatever the cause — Supabase platform quirk, anon role config, hidden
-- restrictive policy — we couldn't reach it via SQL.
--
-- This PR changes the architecture: anon no longer writes to client_intake
-- directly. Instead, a SECURITY DEFINER RPC owned by `postgres` runs the
-- INSERT with elevated privileges (postgres bypasses RLS by design since
-- FORCE ROW LEVEL SECURITY is OFF). Anon callers invoke the RPC; the table
-- itself becomes write-protected from anon entirely.
--
-- Benefits over policy-on-table:
--   1. Centralized server-side validation (we can add rate limit / spam
--      checks / agent_id assignment in the function body later).
--   2. No reliance on RLS WITH CHECK evaluating correctly.
--   3. Schema changes (new columns) don't risk re-breaking anon submissions.
--   4. Single audit point — every intake submission flows through one
--      function.
--
-- The AUDIT_REPORT.md §1.1.4 concern (cross-agent readability) remains
-- dormant for now. agent_id stays out of the table until multi-tenant work.

-- ============================================================
-- 1. Remove anon direct-INSERT access to the table.
-- ============================================================
-- Keep the authenticated agent's read/update/delete policies (from
-- migration 042 rollback) so the agent app continues to work. Only the
-- anon INSERT path changes — it routes through the RPC now.
DROP POLICY IF EXISTS "intake_insert_public" ON public.client_intake;

-- Also revoke direct INSERT grant from anon so they can't even attempt it.
REVOKE INSERT ON public.client_intake FROM anon;

-- ============================================================
-- 2. The RPC: public.submit_intake(payload jsonb)
-- ============================================================
-- Accepts a jsonb object whose keys match client_intake column names.
-- Unknown keys are silently ignored by jsonb_populate_record. Returns
-- the new row's id on success.
--
-- SECURITY DEFINER means the function runs as its owner (postgres) — that
-- role bypasses RLS, so the INSERT lands regardless of policy state.
--
-- search_path is pinned to a safe path so a hostile schema in the caller's
-- search_path can't shadow `client_intake`.
CREATE OR REPLACE FUNCTION public.submit_intake(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'submit_intake: payload must be a jsonb object';
  END IF;

  -- Minimal field guards — payload MUST have email + at least one name field
  IF NULLIF(payload->>'email', '') IS NULL THEN
    RAISE EXCEPTION 'submit_intake: email is required';
  END IF;
  IF NULLIF(payload->>'full_name', '') IS NULL
     AND NULLIF(payload->>'first_name', '') IS NULL THEN
    RAISE EXCEPTION 'submit_intake: full_name or first_name is required';
  END IF;

  -- jsonb_populate_record over NULL::client_intake nulls every column, which
  -- overrides the table's column DEFAULTs (including id's gen_random_uuid()).
  -- Inject a generated id into the payload before populating so the row's
  -- id column lands non-NULL. Strip any client-supplied id first so the
  -- caller can't dictate primary keys.
  payload := (payload - 'id') || jsonb_build_object('id', new_id);

  INSERT INTO public.client_intake
  SELECT * FROM jsonb_populate_record(NULL::public.client_intake, payload);

  RETURN jsonb_build_object('id', new_id);
END;
$$;

-- Lock down EXECUTE: only anon and authenticated can call it.
REVOKE EXECUTE ON FUNCTION public.submit_intake(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_intake(jsonb) TO anon, authenticated;

-- ============================================================
-- 3. Smoke tests (run after applying)
-- ============================================================
-- a) anon can call the RPC successfully:
--      curl -X POST $URL/rest/v1/rpc/submit_intake \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -d '{"payload":{"full_name":"RPC Test","email":"rpc@test.com"}}'
--      → 200 with {"id": "..."}
--
-- b) anon CANNOT write directly anymore (extra defence):
--      curl -X POST $URL/rest/v1/client_intake \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -d '{"full_name":"Direct Test","email":"direct@test.com"}'
--      → permission denied (no INSERT grant for anon anymore)
--
-- c) authenticated agent reads continue working:
--      SELECT count(*) FROM client_intake;  -- as the agent → all rows
--
-- d) cleanup the test rows:
--      DELETE FROM client_intake WHERE email IN ('rpc@test.com');
