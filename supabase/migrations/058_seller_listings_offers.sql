-- Migration 058: Seller pipeline Phase 1+2 — listing dates + offer bidding board
-- Adds the seller-side dates Maxwell tracks (offer review deadline, target sold)
-- and a listing_offers table for logging competing offers against a listing.
-- Offers are auto-numbered per listing; ranking vs asking is computed in the app.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS offer_review_deadline date;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS target_sold_date      date;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS bidding_closed_at     timestamptz;

CREATE TABLE IF NOT EXISTS listing_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL,
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  offer_no    int  NOT NULL,               -- Offer #1, #2, #3… per listing
  buyer_name  text,                        -- optional (or buyer's agent)
  buyer_agent text,
  amount      numeric NOT NULL,
  deposit     numeric,
  conditions  text,                        -- e.g. financing, inspection
  status      text NOT NULL DEFAULT 'received',  -- received | declined | winner
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_offers_listing_idx ON listing_offers(listing_id);
CREATE INDEX IF NOT EXISTS listing_offers_agent_idx   ON listing_offers(agent_id);

ALTER TABLE listing_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "listing_offers_own" ON listing_offers;
CREATE POLICY "listing_offers_own" ON listing_offers
  FOR ALL
  USING      (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);
