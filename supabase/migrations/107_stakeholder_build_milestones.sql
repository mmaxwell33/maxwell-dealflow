-- 107_stakeholder_build_milestones.sql
-- Make the stakeholder portal read the same number the app reads.
--
-- THE BUG THIS FIXES:
--
-- The pipeline card in the app computes build progress from
-- new_builds.pipeline_milestones: five stages, each with a set of steps, and
-- the percentage is how many of those steps are ticked. On 2026-09-06 a deal
-- showed 39% there.
--
-- The stakeholder portal showed 9% for the same deal at the same moment. It was
-- not reading milestones at all. It was reading new_builds.current_stage, a
-- single text label, and looking it up in an eleven item list to get a
-- position. Two problems with that:
--
--   1. The label it was handed was 'Pre-Construction', which is not in that
--      eleven item list. js/newbuilds.js writes labels like 'Deposit Paid' and
--      js/extras.js writes 'Pre-Construction', and only the first vocabulary
--      was ever in the portal. indexOf returned -1, the portal's code turned
--      that into position 0, and position 0 of 11 renders as 9%. So a stage it
--      could not identify at all was displayed as confident early progress.
--
--   2. Even with matching vocabularies the two numbers could not agree, because
--      one counts ticked steps and the other counts a position in a list.
--
-- The fix is one source of truth. This function now also returns the raw
-- pipeline_milestones, and the portal computes exactly what the card computes.
-- current_stage is still returned for the older display paths and as a fallback
-- for builds that predate milestones.
--
-- Run in the Supabase SQL Editor. Safe to re-run. Replaces the function from
-- migration 055; nothing else about it changes.

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
                              'current_stage', NULL, 'stage_history', '[]'::jsonb,
                              'pipeline_milestones', '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_new_build', true,
    'current_stage',  v_build.current_stage,
    'stage_history',  COALESCE(v_build.stage_history, '[]'::jsonb),
    -- The addition. Step booleans only; no builder contacts, costs or private
    -- notes from new_builds go anywhere near a token holder.
    'pipeline_milestones', COALESCE(v_build.pipeline_milestones, '{}'::jsonb),
    'est_close_date', v_build.est_close_date,
    'lot_address',    v_build.lot_address
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.stakeholder_build_progress(text) TO anon;
GRANT EXECUTE ON FUNCTION public.stakeholder_build_progress(text) TO authenticated;
