-- ─────────────────────────────────────────────────────────────────────────────
-- 075_referral_deal_stage.sql — show the shared client's REAL-ESTATE stage in
-- the broker's portal. For clients Maxwell works WITH Asare (linked referrals),
-- Maxwell's app writes the current derived deal stage (Searching / Viewings /
-- Offers / Under Contract / Conditions / Closing / Closed / Fell Through) onto the
-- referral row so Asare can see where each shared deal stands. Asare can't read
-- Maxwell's clients/pipeline directly (RLS), so the stage is denormalized here and
-- kept current whenever Maxwell opens his Clients screen. Status label only, no PII.
--
-- Apply in the Supabase SQL Editor after 074. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS deal_stage TEXT;
