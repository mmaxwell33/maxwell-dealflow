-- Migration 013: Add missing milestone date columns to pipeline table
-- financing_date and inspection_date were referenced in the UI but never added to the schema

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS financing_date   date,
  ADD COLUMN IF NOT EXISTS inspection_date  date;
