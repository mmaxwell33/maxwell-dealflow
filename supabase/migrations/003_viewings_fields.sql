-- Maxwell DealFlow CRM — Phase 3 Viewing Fields Migration
-- Adds offer due date/time and seller's direction to the viewings table.
-- Safe to re-run (all statements are idempotent).

ALTER TABLE viewings ADD COLUMN IF NOT EXISTS offer_due_date date;
ALTER TABLE viewings ADD COLUMN IF NOT EXISTS offer_due_time time;
ALTER TABLE viewings ADD COLUMN IF NOT EXISTS sellers_direction text;
