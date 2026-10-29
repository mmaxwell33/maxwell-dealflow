-- Migration 119: the buyers want more than the builder's standard on a
-- selection (e.g. plumbing fixtures). The vendor email then asks to book an
-- upgrade appointment and quote the price difference over the allowance;
-- upgrade_note (migration 118) holds that price once the vendor gives it.

ALTER TABLE build_selections
  ADD COLUMN IF NOT EXISTS wants_upgrade boolean DEFAULT false;
