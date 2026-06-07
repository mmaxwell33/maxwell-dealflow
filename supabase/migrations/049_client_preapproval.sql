-- ─────────────────────────────────────────────────────────────────────────────
-- 049_client_preapproval.sql
-- Adds a structured pre-approval column to clients so it can be edited as a
-- proper dropdown on the Edit Client screen, instead of living only inside the
-- free-text notes field. Safe / idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preapproval TEXT;

COMMENT ON COLUMN public.clients.preapproval IS 'Buyer mortgage pre-approval status (e.g. "In progress", "Not yet — need guidance"). Mirrors the intake pre-approval options.';
