-- 035_stakeholder_resolve_skipped_flags.sql
-- Adds `inspection_skipped` and `walkthrough_skipped` to the stakeholder_resolve
-- RPC return payload so the client/stakeholder portal can render the segmented
-- progress bar correctly (showing "No inspection" / "No walkthrough" labels).

CREATE OR REPLACE FUNCTION public.stakeholder_resolve(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stake     deal_stakeholders%ROWTYPE;
  v_pipe      pipeline%ROWTYPE;
  v_checklist jsonb := '[]'::jsonb;
  v_today     date  := current_date;
  v_agent_name  text;
  v_agent_phone text;
BEGIN
  SELECT * INTO v_stake FROM deal_stakeholders
  WHERE token = p_token AND revoked_at IS NULL
  LIMIT 1;

  IF v_stake.id IS NULL THEN
    RETURN jsonb_build_object('error','invalid_or_expired');
  END IF;

  SELECT * INTO v_pipe FROM pipeline WHERE id = v_stake.pipeline_id LIMIT 1;
  IF v_pipe.id IS NULL THEN
    RETURN jsonb_build_object('error','invalid_or_expired');
  END IF;

  SELECT full_name, phone INTO v_agent_name, v_agent_phone
  FROM agents WHERE id = v_pipe.agent_id LIMIT 1;

  -- Build checklist (acceptance, financing, inspection, walkthrough, closing)
  IF v_pipe.acceptance_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','Acceptance','due_date',v_pipe.acceptance_date,
      'completed', v_pipe.acceptance_date <= v_today
    );
  END IF;
  IF v_pipe.financing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','Financing','due_date',v_pipe.financing_date,
      'completed', v_pipe.financing_date <= v_today
    );
  END IF;
  IF v_pipe.inspection_date IS NOT NULL
     OR coalesce(v_pipe.inspection_skipped, false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     CASE WHEN coalesce(v_pipe.inspection_skipped, false)
                        THEN 'Inspection (skipped)'
                        ELSE 'Inspection' END,
      'due_date',  v_pipe.inspection_date,
      'completed', coalesce(v_pipe.inspection_skipped, false)
                   OR (v_pipe.inspection_date IS NOT NULL AND v_pipe.inspection_date <= v_today)
    );
  END IF;
  IF v_pipe.walkthrough_date IS NOT NULL
     OR coalesce(v_pipe.walkthrough_skipped, false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     CASE WHEN coalesce(v_pipe.walkthrough_skipped, false)
                        THEN 'Walkthrough (skipped)'
                        ELSE 'Walkthrough' END,
      'due_date',  v_pipe.walkthrough_date,
      'completed', coalesce(v_pipe.walkthrough_skipped, false)
                   OR (v_pipe.walkthrough_date IS NOT NULL AND v_pipe.walkthrough_date <= v_today)
    );
  END IF;
  IF v_pipe.closing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','Closing','due_date',v_pipe.closing_date,
      'completed', v_pipe.closing_date <= v_today
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'role', v_stake.role,
    'name', v_stake.name,
    'stakeholder_name', v_stake.name,
    'property', v_pipe.property_address,
    'mls_number', v_pipe.mls_number,
    'stage', v_pipe.stage,
    'offer_amount', v_pipe.offer_amount,
    'acceptance_date',     v_pipe.acceptance_date,
    'financing_deadline',  v_pipe.financing_date,
    'inspection_deadline', v_pipe.inspection_date,
    'walkthrough_date',    v_pipe.walkthrough_date,
    'closing_date',        v_pipe.closing_date,
    -- NEW: skipped flags so the client portal can render "No inspection" / "No walkthrough"
    'inspection_skipped',  coalesce(v_pipe.inspection_skipped, false),
    'walkthrough_skipped', coalesce(v_pipe.walkthrough_skipped, false),
    'agent_name',  COALESCE(v_agent_name,  'Maxwell Delali Midodzi'),
    'agent_phone', COALESCE(v_agent_phone, '(709) 325-0545'),
    'expires_at',  (now() + interval '90 days'),
    'checklist',   v_checklist
  );
END
$function$;

-- Verification:
-- SELECT proname, pronargs FROM pg_proc WHERE proname = 'stakeholder_resolve';
