-- ─────────────────────────────────────────────────────────────────────────────
-- 078_submit_intake_auto_route_broker.sql
-- Financing Lane: auto-route website lender leads to the broker's portal.
--
-- Previously submit_intake (068) created the broker referral with broker_id NULL,
-- so the lead only showed in Maxwell's funnel until he manually forwarded it. Now
-- the referral is stamped with the founder's ACTIVE broker (agents.broker_email →
-- the matching role='broker' account), so it appears in that broker's "Reached
-- out" tab the moment someone submits — both Maxwell and the broker see it at
-- once. Change the saved broker email in Settings and future leads follow it.
--
-- If no broker is configured (or has no portal login), broker_id stays NULL and
-- behaviour is exactly as before (shows in Maxwell's funnel/bell only).
--
-- Only the referral block changed from 068. Apply in the Supabase SQL Editor
-- (db push is out of sync). Run AFTER 068. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_intake(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id         uuid := gen_random_uuid();
  founder        uuid;
  v_broker_email text;
  v_broker_id    uuid;
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

  SELECT a.id INTO founder
    FROM public.agents a
    JOIN auth.users u ON u.id = a.id
   WHERE lower(a.email) = 'maxwell.midodzi@exprealty.com'
   LIMIT 1;
  IF founder IS NULL THEN
    founder := 'fe551eb0-7d5a-4302-880f-003ac36ace07'::uuid;
  END IF;

  payload := (payload - 'id' - 'agent_id')
           || jsonb_build_object('id', new_id, 'agent_id', founder);

  IF NOT (payload ? 'intake_type') OR NULLIF(payload->>'intake_type', '') IS NULL THEN
    payload := payload || jsonb_build_object('intake_type', 'buyer');
  END IF;

  INSERT INTO public.client_intake
  SELECT * FROM jsonb_populate_record(NULL::public.client_intake, payload);

  -- ── website lender lead → create a pending broker referral, auto-linked ─────
  IF lower(coalesce(payload->>'referral_source', '')) LIKE '%lender%'
     OR lower(coalesce(payload->>'referral_source', '')) LIKE '%mortgage%' THEN

    -- Resolve the founder's ACTIVE broker: the email saved in Settings, matched
    -- to a broker-role account. NULL if none set up (then it stays unlinked).
    SELECT lower(broker_email) INTO v_broker_email FROM public.agents WHERE id = founder;
    IF v_broker_email IS NOT NULL THEN
      SELECT id INTO v_broker_id
        FROM public.agents
       WHERE role = 'broker' AND lower(email) = v_broker_email
       LIMIT 1;
    END IF;

    BEGIN
      INSERT INTO public.broker_referral_requests
        (agent_id, client_id, broker_id, client_name, client_email, client_phone, token, status, source)
      VALUES
        (founder, NULL, v_broker_id,
         NULLIF(payload->>'full_name', ''),
         NULLIF(payload->>'email', ''),
         NULLIF(payload->>'phone', ''),
         gen_random_uuid()::text,
         'pending', 'website');
    EXCEPTION WHEN unique_violation THEN
      -- An active referral for this email already exists; make sure it's linked
      -- to the current broker so it still surfaces in the portal.
      UPDATE public.broker_referral_requests
         SET broker_id = v_broker_id
       WHERE lower(client_email) = lower(NULLIF(payload->>'email', ''))
         AND status IN ('pending', 'approved')
         AND broker_id IS NULL;
    END;
  END IF;

  RETURN jsonb_build_object('id', new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_intake(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_intake(jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Smoke test (run after applying, then clean up):
--   SELECT public.submit_intake('{"full_name":"Lane Test","email":"lane@test.com",
--     "phone":"7095550000","referral_source":"Website: Connect with a lender"}'::jsonb);
--   SELECT status, source, broker_id, client_email FROM public.broker_referral_requests
--     WHERE client_email = 'lane@test.com';   -- expect broker_id = your broker's id
--   DELETE FROM public.broker_referral_requests WHERE client_email = 'lane@test.com';
--   DELETE FROM public.client_intake            WHERE email = 'lane@test.com';
-- ─────────────────────────────────────────────────────────────────────────────
