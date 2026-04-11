-- Migration 012: Add missing columns to offers table
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;
