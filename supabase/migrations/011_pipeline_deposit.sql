-- Migration 011: Add deposit tracking columns to pipeline table
-- Deposit cheque is due to seller's agent within 24 hours of acceptance

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS deposit_due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_sent_at TIMESTAMPTZ;
