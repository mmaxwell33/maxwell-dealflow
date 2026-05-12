-- 039_closing_reschedule.sql
-- Closing-date reschedule feature.
--
-- WHY: Today Maxwell can silently overwrite pipeline.closing_date via the inline
-- date field — that wipes the original date, leaves no audit trail, and the
-- buyer's live portal changes with no explanation. This migration introduces
-- a proper reschedule action:
--
--   1. pipeline.original_closing_date   — frozen the FIRST time a deal is
--      rescheduled. Never overwritten after that. Lets the pipeline card and
--      buyer portal show "originally May 12 → now May 22".
--
--   2. pipeline_reschedules             — append-only log. One row per
--      reschedule with reason, optional notes, and who did it. Latest row
--      surfaces on the buyer portal banner.
--
--   3. stakeholder_resolve()            — recreated to also return
--      original_closing_date + latest_reschedule_reason + latest_reschedule_notes
--      so the portal can render the banner in one round-trip.
--
-- This is additive — nothing existing changes shape.

-- ── 1) Pipeline column ──────────────────────────────────────────────────────
ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS original_closing_date date;

-- ── 2) Reschedule log table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_reschedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id  uuid NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  agent_id     uuid NOT NULL,
  date_from    date NOT NULL,                       -- closing date BEFORE the reschedule
  date_to      date NOT NULL,                       -- new closing date
  reason       text NOT NULL,                       -- one of the preset codes
  notes        text,                                -- optional free-text (e.g. lawyer email excerpt)
  notify_sent  boolean DEFAULT false,               -- did we queue a buyer email for this reschedule?
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_reschedules_pipeline_idx
  ON pipeline_reschedules (pipeline_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_reschedules_agent_idx
  ON pipeline_reschedules (agent_id);

-- Row-level security — mirrors the pipeline table policy.
ALTER TABLE pipeline_reschedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see only their own pipeline_reschedules" ON pipeline_reschedules;
CREATE POLICY "Agents see only their own pipeline_reschedules"
  ON pipeline_reschedules FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- ── 3) Extend stakeholder_resolve so the buyer portal sees the reschedule ──
-- IMPORTANT: this is a SUPERSET of migration 035 — it must preserve the
-- token_expires renewal, role-filtered documents, stakeholder_completed_at,
-- and the inspection_skipped / walkthrough_skipped flags. Only NEW additions
-- are original_closing_date + latest_reschedule_reason + latest_reschedule_notes.

CREATE OR REPLACE FUNCTION public.stakeholder_resolve(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_stake       deal_stakeholders;
  v_pipe        pipeline;
  v_client      clients;
  v_agent_name  text;
  v_agent_phone text;
  v_checklist   jsonb;
  v_documents   jsonb;
  v_resch_reason text;
  v_resch_notes  text;
  v_resch_at     timestamptz;
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

  -- NEW in 039: latest reschedule reason/notes (most recent row only)
  SELECT reason, notes, created_at
    INTO v_resch_reason, v_resch_notes, v_resch_at
    FROM pipeline_reschedules
   WHERE pipeline_id = v_pipe.id
   ORDER BY created_at DESC
   LIMIT 1;

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
    'inspection_skipped',  coalesce(v_pipe.inspection_skipped, false),
    'walkthrough_skipped', coalesce(v_pipe.walkthrough_skipped, false),
    -- NEW in 039: closing reschedule context for the portal banner
    'original_closing_date',     v_pipe.original_closing_date,
    'latest_reschedule_reason',  v_resch_reason,
    'latest_reschedule_notes',   v_resch_notes,
    'latest_reschedule_at',      v_resch_at,
    'agent_name',  COALESCE(v_agent_name,  'Maxwell Delali Midodzi'),
    'agent_phone', COALESCE(v_agent_phone, '(709) 325-0545'),
    'expires_at',  (now() + interval '90 days'),
    'checklist',   v_checklist,
    'documents',   v_documents
  );
END
$function$;
