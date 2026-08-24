-- 099_cmas.sql
-- What has been selling, written up for the client.
--
-- WHY:
--
-- A CMA is a PDF that lives in Matrix and then in a Downloads folder. The
-- client gets it as an attachment they mostly do not open, because it is a
-- grid of comparables written for an agent. What they actually want to know
-- is: what have homes like this one been going for lately, and what does that
-- mean for my number.
--
-- This table holds the answer to that, per client and per property, so the
-- letter that was sent can be read back later without opening the PDF again.
-- It also means "what did I tell them in August" has an answer.
--
-- THE ANALYSIS IS SUPPLIED, NOT INVENTED. Maxwell drops his own CMA and the
-- comparables are read off it. Nothing here is sourced by DealFlow, and no
-- figure appears in the letter that was not on the document he supplied.
--
-- side: 'buyer' and 'seller' read the SAME sales and end differently, one on
-- an opening range and one on a listing range. Stored because the wording of
-- what was sent depends on it.
--
-- viewing_id is nullable ON PURPOSE. A buyer's CMA is anchored to a home they
-- actually viewed, which is where the subject property's details come from. A
-- seller listing their own home has no viewing, and locking the feature behind
-- one would rule out listing presentations, which is the higher-value half.

CREATE TABLE IF NOT EXISTS cmas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  client_id         uuid REFERENCES clients(id) ON DELETE SET NULL,
  viewing_id        uuid REFERENCES viewings(id) ON DELETE SET NULL,

  side              text NOT NULL DEFAULT 'buyer',   -- 'buyer' | 'seller'
  property_address  text NOT NULL,
  mls_number        text,
  list_price        numeric,

  -- The sales themselves, as read off the supplied document. Array of
  -- { address, sold_price, sold_date, days_on_market, note }.
  comparables       jsonb NOT NULL DEFAULT '[]'::jsonb,
  window_months     integer DEFAULT 3,   -- 3 normally, 6 when the street was quiet
  window_widened    boolean DEFAULT false,

  sold_low          numeric,   -- what the comparables actually sold between
  sold_high         numeric,
  suggested_low     numeric,   -- what Maxwell recommends: an opening or listing range
  suggested_high    numeric,

  letter            text,      -- exactly what the client was sent
  doc_path          text,      -- the supplied CMA in the private deal-docs bucket
  doc_name          text,
  extracted_at      timestamptz,
  extraction_model  text,

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cmas_agent_idx   ON cmas(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cmas_client_idx  ON cmas(client_id);
CREATE INDEX IF NOT EXISTS cmas_viewing_idx ON cmas(viewing_id);

ALTER TABLE cmas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own cmas" ON cmas;
CREATE POLICY "own cmas" ON cmas
  FOR ALL USING (agent_id = auth.uid()) WITH CHECK (agent_id = auth.uid());

COMMENT ON TABLE cmas IS
  'Comparative market analyses sent to clients. The comparables are read off a CMA the agent supplied; DealFlow sources no sales data of its own.';
COMMENT ON COLUMN cmas.side IS
  '''buyer'' ends on a suggested opening range, ''seller'' on a suggested listing range. Same sales either way.';
COMMENT ON COLUMN cmas.viewing_id IS
  'The viewing this was written against, when there is one. NULL for a seller''s own home, which was never viewed.';
COMMENT ON COLUMN cmas.window_widened IS
  'True when fewer than three sales fell in the 3 month window and it was widened to 6. The letter says so when this is true.';
COMMENT ON COLUMN cmas.letter IS
  'The exact text sent to the client, after any edits the agent made before approving.';
