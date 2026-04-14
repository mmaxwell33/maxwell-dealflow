-- Maxwell DealFlow CRM — Migration 016: Denormalize viewing_responses
-- Stores property + client data directly in the token row so respond.html
-- never needs to JOIN viewings or clients (which are RLS-protected).
-- Safe to re-run — all ADD COLUMN IF NOT EXISTS.

ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS agent_id         uuid;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS property_address text;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS list_price       numeric;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS mls_number       text;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS client_name      text;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS client_email     text;
