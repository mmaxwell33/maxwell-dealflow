-- Migration 055: stakeholder_build_progress(token)
--
-- Lets the stakeholder portal (stakeholder.html) show the CONSTRUCTION stages
-- for a new-build deal, so a lawyer / lender opening their existing portal link
-- sees the live build progress — not just the generic Accepted→Closing journey.
--
-- Deliberately SEPARATE from stakeholder_resolve() so the production portal
-- function is left completely untouched. The portal calls this in ADDITION to
-- stakeholder_resolve; for existing-home deals it simply returns
-- is_new_build=false and the portal renders exactly as before.
--
-- Reuses the same deal_stakeholders token the portal already trusts.

CREATE OR REPLACE FUNCTION public.stakeholder_build_progress(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_stake deal_stakeholders;
  v_pipe  pipeline;
  v_build new_builds;
BEGIN
  SELECT * INTO v_stake FROM deal_stakeholders
   WHERE token = p_token AND revoked_at IS NULL AND token_expires > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  END IF;

  SELECT * INTO v_pipe FROM pipeline WHERE id = v_stake.pipeline_id;

  IF v_pipe.deal_type IS DISTINCT FROM 'new_build' THEN
    RETURN jsonb_build_object('ok', true, 'is_new_build', false);
  END IF;

  -- Matches how the pipeline links builds to deals: by client (most recent).
  SELECT * INTO v_build FROM new_builds
   WHERE client_id = v_stake.client_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_build.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_new_build', true,
                              'current_stage', NULL, 'stage_history', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_new_build', true,
    'current_stage',  v_build.current_stage,
    'stage_history',  COALESCE(v_build.stage_history, '[]'::jsonb),
    'est_close_date', v_build.est_close_date,
    'lot_address',    v_build.lot_address
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.stakeholder_build_progress(text) TO anon;
GRANT EXECUTE ON FUNCTION public.stakeholder_build_progress(text) TO authenticated;
