-- 023b_pipeline_skip_milestones_fix.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- HOTFIX for migration 023.
--
-- 023 inadvertently changed the JSON shape returned by stakeholder_resolve(),
-- which broke the live client portal page (stakeholder.html) — it stayed on
-- "Loading…" because js/stakeholder-portal.js could not find the fields it
-- expects (stakeholder_name, property, stage, offer_amount, *_deadline,
-- agent_name/phone flat, expires_at, and checklist rows keyed `completed`).
--
-- This migration re-applies the original 022 return shape *and* the skip-flag
-- behaviour added in 023, so existing portal links (e.g. James's) keep working
-- with no client-side change. Migration 023's column additions
-- (inspection_skipped, walkthrough_skipped) are kept — only the function body
-- is corrected.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.stakeholder_resolve(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
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

  -- Skip the inspection row entirely when:
  --   • inspection_skipped is TRUE  (buyer waived it), OR
  --   • inspection_date is NULL     (not yet booked)
  IF v_pipe.inspection_date IS NOT NULL
     AND coalesce(v_pipe.inspection_skipped, false) IS NOT TRUE THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🔍 Inspection',
      'due_date',  v_pipe.inspection_date,
      'completed', v_pipe.inspection_date <= current_date
    );
  END IF;

  -- Same skip rule for walkthrough
  IF v_pipe.walkthrough_date IS NOT NULL
     AND coalesce(v_pipe.walkthrough_skipped, false) IS NOT TRUE THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🚶 Walkthrough',
      'due_date',  v_pipe.walkthrough_date,
      'completed', v_pipe.walkthrough_date <= current_date
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
