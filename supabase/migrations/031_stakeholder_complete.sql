-- Maxwell DealFlow — Stakeholder Pilot Foundation (Phase 1 of V2 audit).
--
-- Adds two pieces:
--   1. completed_at column on deal_stakeholders so each stakeholder lane can
--      be marked finished by the stakeholder themselves.
--   2. stakeholder_complete(p_token) RPC. The stakeholder calls this from
--      their portal when they tap "Mark my lane done". It writes
--      completed_at = now() AND advances the right pipeline field based on
--      the stakeholder's role.
--
-- Role-to-pipeline mapping:
--   mortgage_broker → pipeline.financing_date  = current_date  (locks "Financing Locked")
--   inspector       → pipeline.inspection_date = current_date  (locks "Inspected")
--   lawyer          → pipeline.legal_cleared   = true          (NEW boolean column)
--
-- We also add legal_cleared so the lawyer's sign-off has somewhere to live.

-- ── 1. Schema additions (idempotent) ─────────────────────────────────
ALTER TABLE deal_stakeholders
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS legal_cleared boolean DEFAULT false;

-- ── 2. The complete-my-lane RPC ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stakeholder_complete(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_stake deal_stakeholders;
  v_role  text;
BEGIN
  -- Resolve token (must be valid + non-revoked + not expired)
  SELECT * INTO v_stake FROM deal_stakeholders
   WHERE token = p_token AND revoked_at IS NULL AND token_expires > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','invalid_or_expired');
  END IF;

  -- Idempotent — only mark + advance once
  IF v_stake.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true,
                              'completed_at', v_stake.completed_at);
  END IF;

  -- Mark the lane done
  UPDATE deal_stakeholders
     SET completed_at = now()
   WHERE id = v_stake.id;

  v_role := lower(coalesce(v_stake.role, ''));

  -- Advance the pipeline based on which role just signed off
  IF v_role IN ('mortgage_broker','broker','mortgage') THEN
    UPDATE pipeline
       SET financing_date = current_date,
           updated_at     = now()
     WHERE id = v_stake.pipeline_id
       AND (financing_date IS NULL OR financing_date > current_date);

  ELSIF v_role IN ('inspector','home_inspector','inspection') THEN
    UPDATE pipeline
       SET inspection_date    = current_date,
           inspection_skipped = false,
           updated_at         = now()
     WHERE id = v_stake.pipeline_id
       AND (inspection_date IS NULL OR inspection_date > current_date);

  ELSIF v_role IN ('lawyer','notary','attorney','legal') THEN
    UPDATE pipeline
       SET legal_cleared = true,
           updated_at    = now()
     WHERE id = v_stake.pipeline_id;
  END IF;

  -- Audit trail
  INSERT INTO activity_log (user_id, table_name, row_id, verb, related_id, created_at)
  VALUES (v_stake.agent_id, 'deal_stakeholders', v_stake.id,
          'stakeholder_lane_completed', v_stake.pipeline_id, now());

  RETURN jsonb_build_object(
    'ok', true,
    'role', v_role,
    'pipeline_id', v_stake.pipeline_id,
    'completed_at', now()
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.stakeholder_complete(text) TO anon;
GRANT EXECUTE ON FUNCTION public.stakeholder_complete(text) TO authenticated;

-- ── 3. Quick verify ──────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'stakeholder_complete';
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'deal_stakeholders' AND column_name = 'completed_at';
