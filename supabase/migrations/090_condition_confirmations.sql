-- 090_condition_confirmations.sql
-- Financing / Inspection condition confirmations.
--
-- WHY: today the pipeline bar ticks Financing and Inspection off the moment the
-- DATE passes. A deadline arriving is not the same thing as a lender approving
-- or an inspection clearing — the bar (and the "UNDER CONTRACT" badge, and the
-- client-facing ticker line) could claim financing was "locked in" on a deal
-- where the lender had gone silent.
--
-- From here on those two milestones wait on an explicit yes/no from the agent:
--
--   <cond>_status         null    → not answered yet (bar shows "awaiting")
--                         cleared → approved / passed  (bar ticks it off)
--                         blocked → answered "not yet", awaiting a decision
--   <cond>_status_at      when the answer was recorded
--   <cond>_status_reason  preset reason code when the answer was "not yet"
--   <cond>_status_note    free text the agent typed
--   <cond>_snooze_until   "ask me again on" date — suppresses the prompt only
--
-- deal_condition_events is the append-only audit log — one row per answer, so
-- an extended deadline keeps its history the same way pipeline_reschedules
-- keeps closing-date history (migration 039).
--
-- Additive only — nothing existing changes shape. Extensions written by the app
-- always set BOTH date column pairs (financing_date + financing_deadline, see
-- migration 063), so the portal and the app stay in agreement.

-- ── 1) Pipeline columns ─────────────────────────────────────────────────────
ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS financing_status         text,
  ADD COLUMN IF NOT EXISTS financing_status_at      timestamptz,
  ADD COLUMN IF NOT EXISTS financing_status_reason  text,
  ADD COLUMN IF NOT EXISTS financing_status_note    text,
  ADD COLUMN IF NOT EXISTS financing_snooze_until   date,
  ADD COLUMN IF NOT EXISTS inspection_status        text,
  ADD COLUMN IF NOT EXISTS inspection_status_at     timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_status_reason text,
  ADD COLUMN IF NOT EXISTS inspection_status_note   text,
  ADD COLUMN IF NOT EXISTS inspection_snooze_until  date;

-- ── 2) Append-only answer log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_condition_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id  uuid NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  agent_id     uuid NOT NULL,
  condition    text NOT NULL,          -- 'financing' | 'inspection'
  outcome      text NOT NULL,          -- 'cleared' | 'blocked'
  action       text,                   -- 'extend' | 'waive' | 'snooze' | 'fell_through' | null
  reason       text,                   -- preset reason code
  notes        text,                   -- free text
  date_from    date,                   -- condition date BEFORE this answer
  date_to      date,                   -- condition date AFTER  this answer
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_condition_events_pipeline_idx
  ON deal_condition_events (pipeline_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_condition_events_agent_idx
  ON deal_condition_events (agent_id);

-- Row-level security — mirrors pipeline_reschedules (migration 039).
ALTER TABLE deal_condition_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see only their own deal_condition_events" ON deal_condition_events;
CREATE POLICY "Agents see only their own deal_condition_events"
  ON deal_condition_events FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- ── 3) Backfill ─────────────────────────────────────────────────────────────
-- Deals that are already finished keep reading as finished: mark their
-- conditions cleared so closed/fell-through history does not suddenly show
-- unanswered prompts. Live deals are deliberately left null — those are the
-- ones the agent should be asked about.
UPDATE pipeline
   SET financing_status  = COALESCE(financing_status,  'cleared'),
       inspection_status = COALESCE(inspection_status, 'cleared')
 WHERE stage IN ('Closed', 'Done', 'Fell Through');
