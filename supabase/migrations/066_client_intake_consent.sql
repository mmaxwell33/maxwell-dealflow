-- Migration 066: store the consent record for website lead forms
--
-- Boardroom Session 05 — the "Speak to a mortgage broker" opt-in shares a
-- visitor's details with a third-party mortgage broker. NL Real Estate Trading
-- Act s.20 requires Maxwell to RETAIN the written referral disclosure. Store the
-- verbatim consent text + timestamp on the intake row so it's an auditable
-- record, not just a checkbox that leaves no trace.
--
-- Why columns (not just notes): notes can be erased when a Form Responses row is
-- cleared or a client's email changes. Dedicated consent columns are the durable
-- record. submit_intake uses jsonb_populate_record, so it picks these up
-- automatically with NO change to the RPC.
--
-- ORDERING GATE: apply this in the Supabase SQL Editor BEFORE the new site page
-- goes live. jsonb_populate_record SILENTLY DROPS any payload key that isn't a
-- real column — if the page ships first, consent_text/consent_at are thrown away
-- with no error and the s.20 record is lost. (The site JS also embeds the consent
-- text in `notes` as a belt-and-suspenders fallback, but the columns are the
-- record of truth.)
--
-- Idempotent — safe to re-run.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS consent_text    text,
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_at      timestamptz;

COMMENT ON COLUMN public.client_intake.consent_text IS
  'Verbatim consent/disclosure wording shown to the visitor at submission (NL s.20 retention record).';
COMMENT ON COLUMN public.client_intake.consent_version IS
  'Version tag of the consent wording, e.g. lender-v1.';
COMMENT ON COLUMN public.client_intake.consent_at IS
  'Timestamp the visitor gave consent.';
