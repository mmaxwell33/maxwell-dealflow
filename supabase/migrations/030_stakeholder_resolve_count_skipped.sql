-- Maxwell DealFlow — align client portal milestone count with agent's pipeline view.
--
-- BEFORE this migration:
--   • Agent's pipeline counted skipped milestones as DONE      → 4/5 = 80%
--   • Client portal stripped them out entirely                  → 2/3 = 67%
--   The same deal showed two different progress numbers depending on who looked.
--
-- AFTER this migration:
--   • Both surfaces count skipped milestones as DONE.
--   • A skipped Inspection or Walkthrough still appears in the client's checklist
--     marked completed — so the client sees "the milestone is taken care of"
--     rather than "the milestone disappeared."
--
-- Body matches migration 025 except for the inspection and walkthrough blocks.
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.stakeholder_resolve(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_stake  deal_stakeholders;
  v_pipe   pipeline;
  v_client clients;
  v_agent_name  text;
  v_agent_phone text;
  v_checklist   jsonb;
BEGIN
  SELECT * INTO v_stake FROM deal_stakeholders
   WHERE token = p_token AND revoked_at IS NULL AND token_expires > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','invalid_or_expired');
  END IF;

  UPDATE deal_stakeholders
     SET token_expires = now() + interval '90 days',
         last_accessed = now()
   WHERE id = v_stake.id;

  SELECT * INTO v_pipe   FROM pipeline WHERE id = v_stake.pipeline_id;
  SELECT * INTO v_client FROM clients  WHERE id = v_stake.client_id;
  SELECT name, phone INTO v_agent_name, v_agent_phone
    FROM agents WHERE id = v_stake.agent_id;

  v_checklist := '[]'::jsonb;

  IF v_pipe.acceptance_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '✅ Acceptance',
      'due_date',  v_pipe.acceptance_date,
      'completed', v_pipe.acceptance_date <= current_date
    );
  END IF;

  IF v_pipe.financing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🏦 Financing',
      'due_date',  v_pipe.financing_date,
      'completed', v_pipe.financing_date <= current_date
    );
  END IF;

  -- Inspection: include if a date is set OR if it has been explicitly skipped.
  -- Skipped → counted as completed (agent decided it's not needed).
  IF v_pipe.inspection_date IS NOT NULL
     OR coalesce(v_pipe.inspection_skipped, false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     CASE WHEN coalesce(v_pipe.inspection_skipped, false)
                        THEN '🔍 Inspection (skipped)'
                        ELSE '🔍 Inspection' END,
      'due_date',  v_pipe.inspection_date,
      'completed', coalesce(v_pipe.inspection_skipped, false)
                   OR (v_pipe.inspection_date IS NOT NULL
                       AND v_pipe.inspection_date <= current_date)
    );
  END IF;

  -- Walkthrough: same pattern as inspection.
  IF v_pipe.walkthrough_date IS NOT NULL
     OR coalesce(v_pipe.walkthrough_skipped, false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     CASE WHEN coalesce(v_pipe.walkthrough_skipped, false)
                        THEN '🚶 Walkthrough (skipped)'
                        ELSE '🚶 Walkthrough' END,
      'due_date',  v_pipe.walkthrough_date,
      'completed', coalesce(v_pipe.walkthrough_skipped, false)
                   OR (v_pipe.walkthrough_date IS NOT NULL
                       AND v_pipe.walkthrough_date <= current_date)
    );
  END IF;

  IF v_pipe.closing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🔑 Closing',
      'due_date',  v_pipe.closing_date,
      'completed', v_pipe.closing_date <= current_date
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
    'agent_name',  COALESCE(v_agent_name,  'Maxwell Delali Midodzi'),
    'agent_phone', COALESCE(v_agent_phone, '(709) 325-0545'),
    'expires_at',  (now() + interval '90 days'),
    'checklist',   v_checklist
  );
END
$function$;

-- Optional verification: pull a sample to confirm the function recompiled correctly
-- SELECT proname, prosrc IS NOT NULL AS has_body
-- FROM pg_proc
-- WHERE proname = 'stakeholder_resolve';
