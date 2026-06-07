-- ─────────────────────────────────────────────────────────────────────────────
-- 050_agent_delete_pin.sql
-- Optional "delete password" for destructive actions. Stores a SHA-256 hash of
-- the agent's chosen delete PIN (never the PIN itself). When set, the UI
-- requires it before deleting. A UI-level deterrent against casual deletion by
-- anyone using the agent's logged-in session — not a substitute for RLS.
-- Safe / idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS delete_pin_hash TEXT;

COMMENT ON COLUMN public.agents.delete_pin_hash IS 'SHA-256 hash of the agent''s delete PIN. NULL = no delete password set.';
