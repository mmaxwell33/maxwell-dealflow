-- ─────────────────────────────────────────────────────────────────────────────
-- 083_email_inbox_sent_html.sql
-- Boardroom (2026-07-24): the sent record in email_inbox stored the pre-send
-- text (email_body), not the HTML actually delivered -- so for a licensed
-- Realtor the app's own record could contradict what the client received.
-- Add sent_html to store the exact delivered HTML (the part mail clients
-- render), written from inside the successful-send block in Approvals.approve().
-- Nullable, additive, no backfill.
--
-- Apply in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_inbox
  ADD COLUMN IF NOT EXISTS sent_html TEXT;
