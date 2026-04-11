-- Migration 009: Add missing columns to new_builds table
-- Adds all fields used by the New Build Tracker form

ALTER TABLE new_builds
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS client_email TEXT,
  ADD COLUMN IF NOT EXISTS cc_email TEXT,
  ADD COLUMN IF NOT EXISTS builder_contact TEXT,
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC,
  ADD COLUMN IF NOT EXISTS lot_price NUMERIC,
  ADD COLUMN IF NOT EXISTS est_completion_date DATE,
  ADD COLUMN IF NOT EXISTS est_close_date DATE,
  ADD COLUMN IF NOT EXISTS flooring_selection TEXT,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS deposit_date DATE,
  ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS pa_submitted_date DATE,
  ADD COLUMN IF NOT EXISTS pa_accepted_date DATE,
  ADD COLUMN IF NOT EXISTS community TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
