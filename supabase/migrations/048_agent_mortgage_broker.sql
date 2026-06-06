-- ─────────────────────────────────────────────────────────────────────────────
-- 048_agent_mortgage_broker.sql
-- Mortgage-broker referral support.
-- Adds the agent's go-to mortgage broker (name + email) so that when a buyer
-- intake indicates they need pre-approval guidance, the CRM can queue a warm
-- intro email to the broker (CC the client) for the agent's approval.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS broker_name  TEXT,
  ADD COLUMN IF NOT EXISTS broker_email TEXT;

COMMENT ON COLUMN public.agents.broker_name  IS 'Agent''s preferred mortgage broker — display name used in referral intros.';
COMMENT ON COLUMN public.agents.broker_email IS 'Agent''s preferred mortgage broker — email the client is introduced to.';
