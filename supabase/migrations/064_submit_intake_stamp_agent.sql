-- Maxwell DealFlow — Migration 064
-- fix: submit_intake must stamp agent_id server-side (Bug B from the
--      boardroom intake investigation, Jul 2026)
--
-- Migration 060 gave client_intake an agent_id + owner-scoped RLS and a
-- column DEFAULT. But the public submit path is the submit_intake RPC
-- (migration 043), which builds the row with
--   INSERT ... SELECT * FROM jsonb_populate_record(NULL::client_intake, payload)
-- SELECT * supplies EVERY column explicitly, including agent_id = NULL, which
-- overrides the DEFAULT. Result: every public submission since 060 landed
-- ownerless (agent_id NULL) and was invisible to all agents under the
-- `agent_id = auth.uid()` read policy.
--
-- This migration:
--   1. Strips any caller-supplied agent_id (an anon endpoint must never let
--      the caller choose the owner) and stamps it server-side.
--   2. Assigns the owner to the founder — resolved DYNAMICALLY from auth.users
--      (the real login), NOT from public.agents, because agents contains an
--      orphan row (maxwelldelali22@gmail.com) whose id is not a real login and
--      which migration 060's blind `agents WHERE created_by IS NULL LIMIT 1`
--      wrongly picked. We anchor on the confirmed founder auth uid instead.
--
-- NOTE: single-founder assignment is intentional for now — the public intake
-- form is Maxwell's form, so unattributed leads route to him. When the form
-- becomes genuinely multi-agent, replace the fixed founder with a per-form
-- attribution token validated here. See the boardroom report.
--
-- Apply via the Supabase SQL editor (db push is out of sync for this project).
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_intake(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id  uuid := gen_random_uuid();
  founder uuid;
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

  -- Resolve the founder to own new leads: the eXp Realty login. Anchor on the
  -- agents row whose id IS a real auth.users id (excludes the orphan) and whose
  -- email is the eXp address; fall back to the confirmed uid if not found.
  SELECT a.id INTO founder
    FROM public.agents a
    JOIN auth.users u ON u.id = a.id
   WHERE lower(a.email) = 'maxwell.midodzi@exprealty.com'
   LIMIT 1;
  IF founder IS NULL THEN
    founder := 'fe551eb0-7d5a-4302-880f-003ac36ace07'::uuid;
  END IF;

  -- jsonb_populate_record nulls every unspecified column, overriding DEFAULTs.
  -- Strip caller-controlled id + agent_id, then stamp both server-side.
  payload := (payload - 'id' - 'agent_id')
           || jsonb_build_object('id', new_id, 'agent_id', founder);

  IF NOT (payload ? 'intake_type') OR NULLIF(payload->>'intake_type', '') IS NULL THEN
    payload := payload || jsonb_build_object('intake_type', 'buyer');
  END IF;

  INSERT INTO public.client_intake
  SELECT * FROM jsonb_populate_record(NULL::public.client_intake, payload);

  RETURN jsonb_build_object('id', new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_intake(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_intake(jsonb) TO anon, authenticated;

-- ============================================================
-- Smoke test (run after applying, then clean up):
--   SELECT public.submit_intake(
--     '{"full_name":"Owner Stamp Test","email":"stamp@test.com"}'::jsonb);
--   -- then confirm it landed OWNED, not NULL:
--   SELECT agent_id, email FROM public.client_intake WHERE email = 'stamp@test.com';
--   -- expect agent_id = fe551eb0-… (the founder), NOT null
--   DELETE FROM public.client_intake WHERE email = 'stamp@test.com';
-- ============================================================
