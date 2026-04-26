-- Migration 025: Propagate MLS number across the system
-- Adds optional mls_number to pending_offers, pipeline, offers — and surfaces
-- it through the two stakeholder/builder portal RPCs so the client + builder
-- portals can display MLS# alongside the address.
-- Existing rows are unaffected (column is optional, no defaults).

-- ── 1. Schema additions ───────────────────────────────────────────────────
ALTER TABLE pending_offers ADD COLUMN IF NOT EXISTS mls_number TEXT;
ALTER TABLE pipeline       ADD COLUMN IF NOT EXISTS mls_number TEXT;
ALTER TABLE offers         ADD COLUMN IF NOT EXISTS mls_number TEXT;

-- ── 2. Re-publish stakeholder_resolve (body matches 023b — only addition is
--      the new 'mls_number' field on the JSON return). Same shape, same
--      checklist logic, same skip rules. ──────────────────────────────────
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

  IF v_pipe.inspection_date IS NOT NULL
     AND coalesce(v_pipe.inspection_skipped, false) IS NOT TRUE THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🔍 Inspection',
      'due_date',  v_pipe.inspection_date,
      'completed', v_pipe.inspection_date <= current_date
    );
  END IF;

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

-- ── 3. Re-publish builder_load (body matches 018 — only addition is
--      'mls_number' on the build object). Same shape, same RPC contract. ───
CREATE OR REPLACE FUNCTION builder_load(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build       new_builds%ROWTYPE;
  v_requests    JSONB;
  v_updates     JSONB;
BEGIN
  SELECT * INTO v_build
  FROM new_builds
  WHERE builder_token = p_token
    AND (builder_token_expires IS NULL OR builder_token_expires > NOW());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_or_expired');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_requests
    FROM builder_visit_requests r WHERE r.build_id = v_build.id;

  SELECT COALESCE(jsonb_agg(u ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_updates
    FROM builder_updates u WHERE u.build_id = v_build.id;

  RETURN jsonb_build_object(
    'build', jsonb_build_object(
      'id',                   v_build.id,
      'lot_address',          v_build.lot_address,
      'mls_number',           v_build.mls_number,
      'builder_name',         v_build.builder_name,
      'current_stage',        v_build.current_stage,
      'pipeline_milestones',  v_build.pipeline_milestones,
      'stage_history',        v_build.stage_history,
      'est_completion_date',  v_build.est_completion_date,
      'updated_at',           v_build.updated_at
    ),
    'visit_requests', v_requests,
    'builder_updates', v_updates
  );
END;
$$;

GRANT EXECUTE ON FUNCTION builder_load(TEXT) TO anon;
