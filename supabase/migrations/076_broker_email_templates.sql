-- ─────────────────────────────────────────────────────────────────────────────
-- 076_broker_email_templates.sql — Financing Lane Phase 1: custom emails.
-- The broker keeps editable email templates on his own agents row. When he sends
-- one to a REFERRED client, it is stamped on the referral row; Maxwell's app then
-- queues it (branded) into HIS Approvals for review before it goes — so every
-- client-facing email routes through Maxwell, from Maxwell (the compliant path;
-- broker's-own-client direct sending stays out of scope while own-clients is frozen).
--
-- Apply in the Supabase SQL Editor after 075. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS broker_templates JSONB;   -- {reachout:{subject,body}, application:{...}, reminder:{...}}

ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS pending_email_subject TEXT,
  ADD COLUMN IF NOT EXISTS pending_email_body    TEXT,
  ADD COLUMN IF NOT EXISTS pending_email_at      TIMESTAMPTZ;
