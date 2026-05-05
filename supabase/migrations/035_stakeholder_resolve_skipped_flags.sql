-- 035_stakeholder_resolve_skipped_flags.sql
-- Adds `inspection_skipped` and `walkthrough_skipped` to the stakeholder_resolve
-- RPC return payload so the client/stakeholder portal can render the segmented
-- progress bar correctly (showing "No inspection" / "No walkthrough" labels).
--
-- IMPORTANT: This is a SUPERSET of migration 033 (deal_documents). It must include
-- the full 033 logic — token_expires renewal, role-filtered document query,
-- stakeholder_completed_at — otherwise it regresses the function.

CREATE OR REPLACE FUNCTION public.stakeholder_resolve(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_stake     deal_stakeholders;
  v_pipe      pipeline;
  v_client    clients;
  v_agent_name  text;
  v_agent_phone text;
  v_checklist   jsonb;
  v_documents   jsonb;
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
      'label','✅ Acceptance','due_date',v_pipe.acceptance_date,
      'completed', v_pipe.acceptance_date <= current_date);
  END IF;
  IF v_pipe.financing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','🏦 Financing','due_date',v_pipe.financing_date,
      'completed', v_pipe.financing_date <= current_date);
  END IF;
  IF v_pipe.inspection_date IS NOT NULL OR coalesce(v_pipe.inspection_skipped,false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label', CASE WHEN coalesce(v_pipe.inspection_skipped,false)
                    THEN '🔍 Inspection (skipped)' ELSE '🔍 Inspection' END,
      'due_date', v_pipe.inspection_date,
      'completed', coalesce(v_pipe.inspection_skipped,false)
                   OR (v_pipe.inspection_date IS NOT NULL
                       AND v_pipe.inspection_date <= current_date));
  END IF;
  IF v_pipe.walkthrough_date IS NOT NULL OR coalesce(v_pipe.walkthrough_skipped,false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label', CASE WHEN coalesce(v_pipe.walkthrough_skipped,false)
                    THEN '🚶 Walkthrough (skipped)' ELSE '🚶 Walkthrough' END,
      'due_date', v_pipe.walkthrough_date,
      'completed', coalesce(v_pipe.walkthrough_skipped,false)
                   OR (v_pipe.walkthrough_date IS NOT NULL
                       AND v_pipe.walkthrough_date <= current_date));
  END IF;
  IF v_pipe.closing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','🔑 Closing','due_date',v_pipe.closing_date,
      'completed', v_pipe.closing_date <= current_date);
  END IF;

  -- Documents — role-filtered (preserved from migration 033)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         d.id,
           'doc_type',   d.doc_type,
           'file_name',  d.file_name,
           'url',        deal_doc_public_url(d.file_path),
           'uploaded_at', d.created_at
         ) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_documents
    FROM deal_documents d
   WHERE d.pipeline_id = v_pipe.id
     AND v_stake.role = ANY(d.visible_to_roles);

  RETURN jsonb_build_object(
    'ok', true,
    'role', v_stake.role,
    'name', v_stake.name,
    'stakeholder_name', v_stake.name,
    'stakeholder_completed_at', v_stake.completed_at,
    'property', v_pipe.property_address,
    'mls_number', v_pipe.mls_number,
    'stage', v_pipe.stage,
    'offer_amount', v_pipe.offer_amount,
    'acceptance_date',     v_pipe.acceptance_date,
    'financing_deadline',  v_pipe.financing_date,
    'inspection_deadline', v_pipe.inspection_date,
    'walkthrough_date',    v_pipe.walkthrough_date,
    'closing_date',        v_pipe.closing_date,
    -- NEW in 035: skipped flags so the client portal can render "No inspection" / "No walkthrough"
    'inspection_skipped',  coalesce(v_pipe.inspection_skipped, false),
    'walkthrough_skipped', coalesce(v_pipe.walkthrough_skipped, false),
    'agent_name',  COALESCE(v_agent_name,  'Maxwell Delali Midodzi'),
    'agent_phone', COALESCE(v_agent_phone, '(709) 325-0545'),
    'expires_at',  (now() + interval '90 days'),
    'checklist',   v_checklist,
    'documents',   v_documents
  );
END
$function$;
