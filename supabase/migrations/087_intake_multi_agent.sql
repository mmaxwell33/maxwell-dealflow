-- ─────────────────────────────────────────────────────────────────────────────
-- 087_intake_multi_agent.sql
-- Makes the public buyer-intake flow (intake.html) agent-aware.
--
-- Two problems, found while checking Maxwell's "will invited agents see my
-- data" question:
--
-- 1. client_intake had NO agent_id column at all. Migration 043's own comment
--    says this was a deliberate, documented deferral: "AUDIT_REPORT.md
--    §1.1.4 concern (cross-agent readability) remains dormant for now.
--    agent_id stays out of the table until multi-tenant work." Multi-tenant
--    work (Agent Portal / invite-agent) has since shipped, so the deferred
--    risk is now live: migration 042's rollback reverted the read policy to
--    `USING (auth.uid() IS NOT NULL)`, meaning ANY signed-in agent — Maxwell
--    or anyone he invites — can currently read EVERY submission, not just
--    their own. This migration is that deferred work.
--
-- 2. intake.html hardcodes "Maxwell Delali Midodzi / eXp Realty" everywhere,
--    including the PIPEDA consent statement, so an invited agent sending this
--    same link to their own client would have that client consent to the
--    WRONG person collecting their data. get_public_agent_profile() below
--    lets the page look up and display the REAL sending agent.
--
-- History note: migration 041 tried a stricter RLS regime here and had to be
-- rolled back (042) because it broke anon INSERTs in an untraceable way. That
-- failure was specifically in the INSERT path; migration 043 already moved
-- INSERT off RLS entirely onto a SECURITY DEFINER RPC, which is unaffected by
-- table policies. This migration only tightens SELECT/UPDATE/DELETE, and
-- explicitly does not touch the INSERT grant/policy shape 043 established.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================
-- 1. agent_id column — nullable so nothing existing breaks, then backfilled.
-- ============================================================
ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

-- Every row that predates this column belongs to the founder (the only agent
-- who could have received submissions before multi-tenant support existed).
UPDATE public.client_intake
   SET agent_id = (SELECT id FROM public.agents WHERE created_by IS NULL LIMIT 1)
 WHERE agent_id IS NULL;

CREATE INDEX IF NOT EXISTS client_intake_agent_idx ON public.client_intake (agent_id);

-- ============================================================
-- 2. submit_intake RPC — now resolves and stamps the correct agent_id.
--    Same signature as migration 043 (payload jsonb) so intake.html/
--    seller-intake.html need no call-site changes beyond adding the key.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_intake(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  target_agent uuid;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'submit_intake: payload must be a jsonb object';
  END IF;

  IF NULLIF(payload->>'email', '') IS NULL THEN
    RAISE EXCEPTION 'submit_intake: email is required';
  END IF;
  IF NULLIF(payload->>'full_name', '') IS NULL
     AND NULLIF(payload->>'first_name', '') IS NULL THEN
    RAISE EXCEPTION 'submit_intake: full_name or first_name is required';
  END IF;

  -- Resolve the agent this submission belongs to. A caller-supplied agent_id
  -- is only trusted if it names a REAL agent row — never take it on faith,
  -- since this function is reachable by anon. Falls back to the founder,
  -- matching every submission's behaviour before this migration.
  IF NULLIF(payload->>'agent_id', '') IS NOT NULL THEN
    SELECT id INTO target_agent FROM public.agents WHERE id = (payload->>'agent_id')::uuid;
  END IF;
  IF target_agent IS NULL THEN
    SELECT id INTO target_agent FROM public.agents WHERE created_by IS NULL LIMIT 1;
  END IF;

  payload := (payload - 'id' - 'agent_id')
             || jsonb_build_object('id', new_id, 'agent_id', target_agent);
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
-- 3. get_public_agent_profile — lets the anonymous intake page show the
--    REAL sending agent's name/brokerage/contact instead of a hardcoded one.
--    Whitelisted columns only: never exposes anything else on `agents`
--    (no pin hashes, no internal settings, nothing agent-private).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_agent_profile(p_agent_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, name text, brokerage text, phone text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.name, a.brokerage, a.phone, a.email
  FROM public.agents a
  WHERE a.id = COALESCE(p_agent_id, (SELECT id FROM public.agents WHERE created_by IS NULL LIMIT 1))
  LIMIT 1;

  -- Unknown / bad id → fall back to the founder rather than returning nothing,
  -- so a broken or tampered link still shows a real, correct recipient.
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT a.id, a.name, a.brokerage, a.phone, a.email
    FROM public.agents a
    WHERE a.created_by IS NULL
    LIMIT 1;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_agent_profile(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_public_agent_profile(uuid) TO anon, authenticated;

-- ============================================================
-- 4. Tighten client_intake reads to the owning agent. INSERT path
--    (anon → submit_intake RPC, no direct anon INSERT grant) is untouched.
-- ============================================================
DROP POLICY IF EXISTS "intake_read_own" ON public.client_intake;
CREATE POLICY "intake_read_own" ON public.client_intake
  FOR SELECT
  USING (agent_id = auth.uid());

DROP POLICY IF EXISTS "intake_update_own" ON public.client_intake;
CREATE POLICY "intake_update_own" ON public.client_intake
  FOR UPDATE
  USING      (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

DROP POLICY IF EXISTS "intake_delete_own" ON public.client_intake;
CREATE POLICY "intake_delete_own" ON public.client_intake
  FOR DELETE
  USING (agent_id = auth.uid());

-- ============================================================
-- 5. Smoke tests (run after applying)
-- ============================================================
-- a) Public profile lookup works for a real agent id and for no id:
--      select * from get_public_agent_profile(null);                    -- founder
--      select * from get_public_agent_profile('<some real agent uuid>');
--      select * from get_public_agent_profile('00000000-0000-0000-0000-000000000000'); -- falls back to founder
--
-- b) anon can still submit, and it lands under the right agent:
--      select submit_intake('{"full_name":"RPC Test","email":"rpc2@test.com","agent_id":"<some real agent uuid>"}'::jsonb);
--      select agent_id from client_intake where email = 'rpc2@test.com';  -- should equal the agent uuid passed in
--
-- c) An invited agent's session now sees ONLY their own submissions:
--      -- as that agent: select count(*) from client_intake;  -- their rows only
--
-- d) cleanup:
--      delete from client_intake where email in ('rpc2@test.com');
