-- ─────────────────────────────────────────────────────────────────────────────
-- 070_broker_handoff.sql
-- Financing Lane v1 — the hand-off. After the broker (Asare) finishes his own
-- financing assessment (on his own Filogix application, off this app) and judges
-- the client is READY to buy a home, he taps "Client is ready" on his lane. That
-- flags the referral 'ready_for_agent'. Maxwell's app then auto-queues HIS buyer
-- intake email to the client (branded, via the existing Intake Link rail) for
-- Maxwell to approve — see App.processBrokerHandoffs() in js/app.js.
--
-- Apply in the Supabase SQL Editor after 067/068/069. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;   -- when the broker handed the client back

-- Broker marks a client ready → hands them to the agent. Only valid once the
-- referral is approved/sent (i.e. the broker is actually working the client).
CREATE OR REPLACE FUNCTION public.broker_handoff_referral(p_token TEXT, p_referral_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_agent UUID; v_won UUID;
BEGIN
  v_agent := public._broker_agent_for_token(p_token);
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  UPDATE public.broker_referral_requests
     SET status = 'ready_for_agent', ready_at = now()
   WHERE id = p_referral_id AND agent_id = v_agent AND status IN ('approved','sent')
   RETURNING id INTO v_won;
  IF v_won IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_ready'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.broker_handoff_referral(TEXT, UUID) TO anon, authenticated;
