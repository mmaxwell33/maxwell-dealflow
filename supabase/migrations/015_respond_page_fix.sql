-- Maxwell DealFlow CRM — Migration 015: Respond Page Fix
-- Fixes the "Something went wrong" error when clients submit from respond.html
--
-- Problems solved:
--   1. viewing_responses was missing columns (decision, offer_amount, etc.)
--   2. viewings RLS blocked anon key from updating client_response
--   3. pending_offers had no anon INSERT policy (or table may not exist)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. VIEWING RESPONSES — create table if missing, add missing columns ──────
CREATE TABLE IF NOT EXISTS viewing_responses (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  viewing_id   uuid NOT NULL,
  client_id    uuid,
  token        text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  expired      boolean NOT NULL DEFAULT false,
  decision     text,           -- 'make_offer' | 'continue_searching' | 'not_a_fit'
  offer_amount numeric,        -- only for make_offer
  client_note  text,           -- optional note from client
  not_fit_reason text,         -- reason if not_a_fit
  responded_at timestamptz,    -- when client submitted
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Add columns if table already exists (safe to re-run)
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS offer_amount numeric;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS client_note text;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS not_fit_reason text;
ALTER TABLE viewing_responses ADD COLUMN IF NOT EXISTS responded_at timestamptz;

-- ── 2. VIEWING RESPONSES — RLS ───────────────────────────────────────────────
ALTER TABLE viewing_responses ENABLE ROW LEVEL SECURITY;

-- Agent reads/manages their own
DROP POLICY IF EXISTS "viewing_responses_agent_own" ON viewing_responses;
CREATE POLICY "viewing_responses_agent_own" ON viewing_responses
  FOR ALL USING (
    client_id IN (SELECT id FROM clients WHERE agent_id = auth.uid())
  );

-- Anon can SELECT (for token lookup in init())
DROP POLICY IF EXISTS "viewing_responses_anon_select" ON viewing_responses;
CREATE POLICY "viewing_responses_anon_select" ON viewing_responses
  FOR SELECT USING (true);

-- Anon can UPDATE to mark responded (only non-expired tokens)
DROP POLICY IF EXISTS "viewing_responses_anon_update" ON viewing_responses;
CREATE POLICY "viewing_responses_anon_update" ON viewing_responses
  FOR UPDATE USING (expired = false AND expires_at > now());

-- ── 3. VIEWINGS — allow anon to set client_response via valid token ──────────
-- Drops any existing anon update policy first, then recreates
DROP POLICY IF EXISTS "viewings_anon_client_response" ON viewings;
CREATE POLICY "viewings_anon_client_response" ON viewings
  FOR UPDATE USING (
    id IN (
      SELECT viewing_id FROM viewing_responses
      WHERE expired = false AND expires_at > now()
    )
  );

-- ── 4. PENDING OFFERS — create table + allow anon INSERT ────────────────────
CREATE TABLE IF NOT EXISTS pending_offers (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  viewing_id       uuid,
  client_id        uuid,
  agent_id         uuid,
  client_name      text,
  property_address text,
  list_price       numeric,
  offer_amount     numeric,
  client_note      text,
  status           text NOT NULL DEFAULT 'Pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pending_offers ENABLE ROW LEVEL SECURITY;

-- Agent can manage their own pending offers
DROP POLICY IF EXISTS "pending_offers_agent_own" ON pending_offers;
CREATE POLICY "pending_offers_agent_own" ON pending_offers
  FOR ALL USING (agent_id = auth.uid());

-- Anon can INSERT (client submitting offer interest from respond.html)
DROP POLICY IF EXISTS "pending_offers_anon_insert" ON pending_offers;
CREATE POLICY "pending_offers_anon_insert" ON pending_offers
  FOR INSERT WITH CHECK (true);

-- Index for fast agent dashboard queries
CREATE INDEX IF NOT EXISTS idx_pending_offers_agent
  ON pending_offers(agent_id, status);
