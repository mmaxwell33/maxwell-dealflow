-- Maxwell DealFlow CRM — Phase 1 Schema Migration
-- Run these statements in order in the Supabase SQL editor.
-- Each block is guarded with IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. approval_queue — add related_id for idempotency checks
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS related_id uuid;

-- Index for fast idempotency lookups (same agent, same related record, same email type, pending status)
CREATE INDEX IF NOT EXISTS idx_approval_dedup
  ON approval_queue(agent_id, related_id, approval_type)
  WHERE status = 'Pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pipeline — add walkthrough_date and status columns if missing
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS walkthrough_date date;
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS client_email text;
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS offer_id uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. clients — add budget_min and property_type if missing
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS budget_min numeric;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS property_type text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. commissions — add pipeline_id FK for linking deals to commissions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS pipeline_id uuid;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS gross_commission numeric;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS tax_amount numeric;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS brokerage_fee_amount numeric;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS close_date date;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. activity_log — rename action → activity_type if using old schema
--    (the code uses activity_type; older schema may have used 'action')
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS activity_type text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS client_id uuid;

-- Backfill activity_type from action for legacy rows
UPDATE activity_log SET activity_type = action WHERE activity_type IS NULL AND action IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. deal_checklist — NEW TABLE for auto-generated closing task lists
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_checklist (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id      uuid NOT NULL,
  pipeline_id   uuid,            -- links to pipeline row (nullable if FK not yet enforced)
  client_id     uuid,
  client_name   text,
  title         text NOT NULL,
  category      text,            -- 'Legal', 'Financing', 'Inspection', 'Moving', 'General'
  due_date      date,
  done          boolean NOT NULL DEFAULT false,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for fast per-deal queries
CREATE INDEX IF NOT EXISTS idx_deal_checklist_pipeline
  ON deal_checklist(agent_id, pipeline_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Row-level security — enable on deal_checklist (agent sees only own rows)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE deal_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_own_checklist" ON deal_checklist;
CREATE POLICY "agent_own_checklist" ON deal_checklist
  FOR ALL USING (agent_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────────────────────────────
