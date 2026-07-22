-- ─────────────────────────────────────────────────────────────────────────────
-- 081_broker_follow_up_date.sql
-- Maxwell (2026-07-22): the broker wants to set a follow-up/call-back date on
-- any client and have it surface as a reminder on the Today tab (and push),
-- the same way a rate-hold expiry already does. Adds one nullable date column
-- to both client tables. Isolation unchanged. Safe to re-run.
-- Apply in the Supabase SQL Editor after 080.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS follow_up_date DATE;

ALTER TABLE public.broker_clients
  ADD COLUMN IF NOT EXISTS follow_up_date DATE;
