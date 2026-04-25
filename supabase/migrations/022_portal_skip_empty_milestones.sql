-- 022_portal_skip_empty_milestones.sql
--
-- Fix: stakeholder portal page was showing "🔍 Inspection" (and a placeholder
-- "⚖️ Lawyer engaged") milestone rows even on deals that have no inspection
-- date set. Reported by user 2026-04-24 — a deal where the Pipeline
-- "Inspection" date was blank still rendered "🔍 Inspection" as an
-- unchecked milestone in the client-facing portal.
--
-- Root cause: stakeholder_resolve() was building a fixed 6-element
-- jsonb_build_array(...) regardless of which dates existed on pipeline.
--
-- Fix: build the checklist conditionally — each milestone is only added
-- when its underlying date column is NOT NULL. Acceptance is the one
-- exception: a deal in pipeline always has acceptance, so it's always shown.
-- The placeholder "Lawyer engaged" row (which has no date column today)
-- is dropped entirely; re-add it later if/when a lawyer_engaged_date
-- column is introduced.
--
-- This preserves SECURITY DEFINER + search_path settings established by
-- earlier migrations.

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

  -- Build checklist: only include a milestone row when its date is set.
  -- Acceptance is always present (every pipeline deal has an acceptance).
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

  IF v_pipe.inspection_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🔍 Inspection',
      'due_date',  v_pipe.inspection_date,
      'completed', v_pipe.inspection_date <= current_date
    );
  END IF;

  IF v_pipe.walkthrough_date IS NOT NULL THEN
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
