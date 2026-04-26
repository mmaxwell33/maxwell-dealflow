-- Migration 024: Add optional MLS number to new_builds
-- Some new-build deals have an MLS listing (resale-style flips, listed pre-construction
-- units, etc). Field is optional — existing rows are unaffected.

ALTER TABLE new_builds
  ADD COLUMN IF NOT EXISTS mls_number TEXT;
