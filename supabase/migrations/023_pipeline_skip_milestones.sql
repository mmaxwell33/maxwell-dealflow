-- 023_pipeline_skip_milestones.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds explicit "skip" flags for the optional Inspection and Walkthrough
-- milestones. Some buyers waive these, so the progress bar should not punish
-- the deal for missing them.
--
-- Behaviour:
--   • Pipeline.milestonesDone()   — excludes skipped milestones from totals
--   • Pipeline card UI            — replaces date input with "Skipped" pill
--   • stakeholder_resolve()       — drops skipped milestones from the client
--                                   portal checklist (in addition to the
--                                   existing "skip on null date" rule).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.pipeline
  add column if not exists inspection_skipped  boolean not null default false,
  add column if not exists walkthrough_skipped boolean not null default false;

-- Update stakeholder_resolve to honour the new skip flags. Same shape as
-- migration 022 — only adds the additional `IS NOT TRUE` checks.
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
      'is_done',   true
    );
  END IF;

  IF v_pipe.financing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🏦 Financing condition',
      'due_date',  v_pipe.financing_date,
      'is_done',   v_pipe.financing_date <= current_date
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
      'is_done',   v_pipe.inspection_date <= current_date
    );
  END IF;

  -- Same skip rule for walkthrough
  IF v_pipe.walkthrough_date IS NOT NULL
     AND coalesce(v_pipe.walkthrough_skipped, false) IS NOT TRUE THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🚶 Final walkthrough',
      'due_date',  v_pipe.walkthrough_date,
      'is_done',   v_pipe.walkthrough_date <= current_date
    );
  END IF;

  IF v_pipe.closing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label',     '🔑 Closing',
      'due_date',  v_pipe.closing_date,
      'is_done',   v_pipe.closing_date <= current_date
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'role',         v_stake.role,
    'name',         v_stake.name,
    'pipeline',     to_jsonb(v_pipe),
    'client',       jsonb_build_object('id', v_client.id, 'full_name', v_client.full_name),
    'agent',        jsonb_build_object('name', v_agent_name, 'phone', v_agent_phone),
    'checklist',    v_checklist
  );
END;
$function$;
