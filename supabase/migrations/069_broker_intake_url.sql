-- ─────────────────────────────────────────────────────────────────────────────
-- 069_broker_intake_url.sql
-- Financing Lane v1 follow-up. The broker (Asare) already has his OWN client
-- application (Filogix "getmy.mortgage" widget). The lane's "Email intake form"
-- button should send THAT link, not a generic one. Store it on the agent row and
-- return it from broker_list_referrals so the lane page can use it.
--
-- Apply in the Supabase SQL Editor after 067/068. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS broker_intake_url TEXT;   -- e.g. the Filogix application link

-- Re-create broker_list_referrals to also return the broker's intake/application URL.
CREATE OR REPLACE FUNCTION public.broker_list_referrals(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE AS $$
DECLARE v_agent UUID; v_has_pass BOOLEAN; v_intake TEXT;
BEGIN
  v_agent := public._broker_agent_for_token(p_token);
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  SELECT (broker_approval_hash IS NOT NULL), broker_intake_url
    INTO v_has_pass, v_intake
    FROM public.agents WHERE id = v_agent;
  RETURN jsonb_build_object(
    'ok', true,
    'has_password', COALESCE(v_has_pass, false),
    'intake_url', v_intake,
    'referrals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.client_name, 'email', r.client_email, 'phone', r.client_phone,
        'status', r.status, 'approved_by', r.approved_by, 'approved_at', r.approved_at,
        'source', r.source, 'created_at', r.created_at,
        'snapshot', jsonb_build_object('max_amount', r.snapshot_max_amount,
          'status', r.snapshot_status, 'rate_hold', r.snapshot_rate_hold)
      ) ORDER BY r.created_at DESC)
      FROM public.broker_referral_requests r
      WHERE r.agent_id = v_agent
        AND r.status IN ('pending','approved','sent')
        AND r.expires_at > now()
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.broker_list_referrals(TEXT) TO anon, authenticated;
