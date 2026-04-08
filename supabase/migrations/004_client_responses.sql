-- Maxwell DealFlow CRM — Migration 004: Client Responses Table
-- Stores client decisions from the interactive response page (respond.html)
-- Clients can: Make an Offer (with amount + notes), Continue Searching, or Pass

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. client_responses — stores client decisions from interactive email links
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_responses (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  viewing_id      uuid NOT NULL,
  client_id       uuid NOT NULL,
  agent_id        uuid,
  property_address text,
  list_price      numeric,
  response_type   text NOT NULL CHECK (response_type IN ('make_offer', 'continue_searching', 'pass')),
  offer_amount    numeric,                -- only for 'make_offer'
  client_notes    text,                   -- optional notes from client
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for fast agent lookups
CREATE INDEX IF NOT EXISTS idx_client_responses_agent
  ON client_responses(agent_id, status);

-- Index for fast viewing lookups
CREATE INDEX IF NOT EXISTS idx_client_responses_viewing
  ON client_responses(viewing_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Row-level security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE client_responses ENABLE ROW LEVEL SECURITY;

-- Agent can read/update their own responses
DROP POLICY IF EXISTS "agent_own_responses" ON client_responses;
CREATE POLICY "agent_own_responses" ON client_responses
  FOR ALL USING (agent_id = auth.uid());

-- Allow anonymous inserts (clients submit from public respond.html page)
DROP POLICY IF EXISTS "anon_insert_responses" ON client_responses;
CREATE POLICY "anon_insert_responses" ON client_responses
  FOR INSERT WITH CHECK (true);

-- Allow anonymous to read their own response (for confirmation page)
DROP POLICY IF EXISTS "anon_read_own_response" ON client_responses;
CREATE POLICY "anon_read_own_response" ON client_responses
  FOR SELECT USING (true);
