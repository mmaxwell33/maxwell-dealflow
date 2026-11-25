-- ─────────────────────────────────────────────────────────────────────────────
-- 123_agent_other_brokers.sql
-- Saved mortgage brokers besides the go-to one (agents.broker_name/broker_email).
-- Settings, Mortgage Broker Referral lists them; the Approvals editor shows them
-- in a "Send to broker" dropdown so one client's intro can go to someone else.
-- Shape: [{ "name": "Pat Sample", "email": "pat@example.com" }, ...]
-- Additive and nullable-safe. The agents row's existing RLS covers it.
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/123_agent_other_brokers.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS other_brokers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- DOWN: ALTER TABLE public.agents DROP COLUMN IF EXISTS other_brokers;
