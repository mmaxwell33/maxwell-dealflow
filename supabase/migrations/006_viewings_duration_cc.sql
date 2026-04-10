-- Add duration and CC email fields to viewings table
ALTER TABLE viewings ADD COLUMN IF NOT EXISTS viewing_duration integer DEFAULT 30;
ALTER TABLE viewings ADD COLUMN IF NOT EXISTS cc_email text;
