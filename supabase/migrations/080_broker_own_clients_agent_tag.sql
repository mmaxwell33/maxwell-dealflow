-- ─────────────────────────────────────────────────────────────────────────────
-- 080_broker_own_clients_agent_tag.sql
-- Maxwell (2026-07-22): the broker works with clients referred by DIFFERENT
-- agents, and wants to manage them all in one place while knowing who each
-- belongs to. This re-enables the broker's own-client feature (frozen in
-- Session 10) with three additions:
--   • referred_by_agent_name / referred_by_agent_email — who sent the client
--   • handed_to_email — the agent the broker hands the finished client back to
-- Isolation is UNCHANGED: broker_clients stays broker_id = auth.uid() only.
-- Maxwell has NO access to these rows — they are the broker's own book, and the
-- broker is the controller responsible for his own clients' consent.
--
-- Apply in the Supabase SQL Editor after 079. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.broker_clients
  ADD COLUMN IF NOT EXISTS referred_by_agent_name  TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_agent_email TEXT,
  ADD COLUMN IF NOT EXISTS handed_to_email         TEXT;

-- status now also allows 'handed_to_agent' (broker emailed the finished client
-- back to their referring agent). No constraint change needed — status is free text.
