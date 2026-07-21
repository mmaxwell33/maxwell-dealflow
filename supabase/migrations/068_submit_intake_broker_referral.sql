-- ─────────────────────────────────────────────────────────────────────────────
-- 068_submit_intake_broker_referral.sql
-- Financing Lane v1, Step 2 (Boardroom Session 09).
--
-- Extends submit_intake (migration 064) so a website "Connect with a lender"
-- lead ALSO creates a `pending` broker_referral_requests row. That shared row is
-- what makes the "two sets of eyes" work: it shows in Maxwell's bell AND in the
-- broker's lane, and either can approve it (idempotently). Public/anon cannot
-- INSERT into broker_referral_requests directly (RLS), so it must happen here,
-- inside the SECURITY DEFINER function, stamped to the founder.
--
-- Everything else about submit_intake is UNCHANGED from 064 — this only adds the
-- referral-creation block near the end. Safe to re-run.
--
-- Apply in the Supabase SQL Editor (db push is out of sync). Run AFTER 067.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- ── NEW (068): website lender lead → create a pending broker referral ──────
  --  Detected by referral_source containing "lender" or "mortgage". The unique
  --  index brr_active_email_uniq (067) prevents duplicate ACTIVE referrals per
  --  email; a repeat submission simply no-ops rather than erroring.
  IF lower(coalesce(payload->>'referral_source', '')) LIKE '%lender%'
     OR lower(coalesce(payload->>'referral_source', '')) LIKE '%mortgage%' THEN
    BEGIN
      INSERT INTO public.broker_referral_requests
        (agent_id, client_id, client_name, client_email, client_phone, token, status, source)
      VALUES
        (founder, NULL,
         NULLIF(payload->>'full_name', ''),
         NULLIF(payload->>'email', ''),
         NULLIF(payload->>'phone', ''),
         gen_random_uuid()::text,
         'pending', 'website');
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- an active referral for this email already exists; ignore duplicate
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
--   SELECT status, source, client_email FROM public.broker_referral_requests
--     WHERE client_email = 'lane@test.com';   -- expect status=pending, source=website
--   DELETE FROM public.broker_referral_requests WHERE client_email = 'lane@test.com';
--   DELETE FROM public.client_intake            WHERE email = 'lane@test.com';
-- ─────────────────────────────────────────────────────────────────────────────
