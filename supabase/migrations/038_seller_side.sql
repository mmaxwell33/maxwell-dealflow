-- Maxwell DealFlow — Seller Side (Phase 1)
-- Adds seller intake + seller pipeline + dual-rep tracking.
-- All changes are ADDITIVE and BACKWARD-COMPATIBLE:
--   • New columns have safe defaults so existing rows keep working unchanged.
--   • New tables don't touch any existing query path until JS opts in.
--   • RLS mirrors the pattern used by deal_documents / pipeline.
--
-- Signatures are handled OUTSIDE DealFlow (Authentisign / board e-sign / paper).
-- DealFlow only records that Maxwell confirmed both clients signed, and
-- optionally archives the signed PDF for audit purposes.
--
-- Run in Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Client type — buyer / seller / both
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'buyer'
  CHECK (client_type IN ('buyer','seller','both'));

CREATE INDEX IF NOT EXISTS clients_client_type_idx ON clients (client_type);

-- Intake form gets the same flag so the agent can see at a glance
-- whether a fresh lead came in as a buyer or seller.
ALTER TABLE client_intake
  ADD COLUMN IF NOT EXISTS intake_type text NOT NULL DEFAULT 'buyer'
  CHECK (intake_type IN ('buyer','seller'));

-- Property fields for seller intakes (nullable — buyers leave them blank)
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS property_address text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS property_type text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS property_bedrooms text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS property_bathrooms text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS property_sqft text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS sell_reason text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS sell_timeline text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS asking_price text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS price_preference text;
ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS best_contact_time text;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Listings — one row per seller property
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            uuid NOT NULL,
  client_id           uuid REFERENCES clients(id) ON DELETE SET NULL,
  property_address    text NOT NULL,
  property_type       text,                       -- detached / semi / condo / townhouse / other
  bedrooms            text,
  bathrooms           text,
  sqft                text,
  asking_price        numeric,
  list_price          numeric,
  mls_number          text,
  listing_status      text NOT NULL DEFAULT 'pre_listing'
                      CHECK (listing_status IN
                        ('pre_listing','cma_delivered','agreement_signed',
                         'prep','active','under_contract','sold','withdrawn')),
  listed_at           date,
  sold_at             date,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listings_agent_idx  ON listings (agent_id);
CREATE INDEX IF NOT EXISTS listings_client_idx ON listings (client_id);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (listing_status);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Agents see only their own listings" ON listings;
CREATE POLICY "Agents see only their own listings"
  ON listings FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- ──────────────────────────────────────────────────────────────────────
-- 3. Pipeline — add deal_side + transaction link
-- ──────────────────────────────────────────────────────────────────────
-- Existing rows default to 'buy' so the entire current pipeline view
-- keeps working with zero JS changes.
ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS deal_side text NOT NULL DEFAULT 'buy'
  CHECK (deal_side IN ('buy','sell'));

-- transaction_id links a buy-side pipeline row to its matching sell-side
-- pipeline row when Maxwell represents BOTH sides. NULL = single rep.
ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS transaction_id uuid;

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pipeline_deal_side_idx     ON pipeline (deal_side);
CREATE INDEX IF NOT EXISTS pipeline_transaction_idx   ON pipeline (transaction_id);
CREATE INDEX IF NOT EXISTS pipeline_listing_idx       ON pipeline (listing_id);

-- ──────────────────────────────────────────────────────────────────────
-- 4. Disclosures — dual-rep confirmation tracking
-- ──────────────────────────────────────────────────────────────────────
-- One row per CLIENT per dual-rep transaction (so two rows total per deal).
-- Signature happens in an external system; Maxwell flips status to 'confirmed'
-- once both clients have signed. Optional signed_pdf_path archives the PDF.
CREATE TABLE IF NOT EXISTS disclosures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id           uuid NOT NULL,
  transaction_id     uuid NOT NULL,            -- matches pipeline.transaction_id
  pipeline_id        uuid REFERENCES pipeline(id) ON DELETE CASCADE,
  client_id          uuid REFERENCES clients(id) ON DELETE SET NULL,
  client_role        text NOT NULL CHECK (client_role IN ('buyer','seller')),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','waived','declined')),
  confirmed_at       timestamptz,
  confirmed_by       uuid,                     -- = agent_id when Maxwell confirms
  signed_pdf_path    text,                     -- optional storage path of archived PDF
  notes              text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS disclosures_agent_idx        ON disclosures (agent_id);
CREATE INDEX IF NOT EXISTS disclosures_transaction_idx  ON disclosures (transaction_id);
CREATE INDEX IF NOT EXISTS disclosures_status_idx       ON disclosures (status);

ALTER TABLE disclosures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Agents see only their own disclosures" ON disclosures;
CREATE POLICY "Agents see only their own disclosures"
  ON disclosures FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- ──────────────────────────────────────────────────────────────────────
-- 5. Storage bucket for archived disclosure PDFs (optional uploads)
-- ──────────────────────────────────────────────────────────────────────
-- Same security model as deal-docs bucket: public URLs but unguessable
-- paths, and write/delete locked to the owning agent's folder.
INSERT INTO storage.buckets (id, name, public)
VALUES ('disclosures', 'disclosures', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Agents upload disclosures to their own folder" ON storage.objects;
CREATE POLICY "Agents upload disclosures to their own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'disclosures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Agents update their own disclosure files" ON storage.objects;
CREATE POLICY "Agents update their own disclosure files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'disclosures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Agents delete their own disclosure files" ON storage.objects;
CREATE POLICY "Agents delete their own disclosure files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'disclosures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ──────────────────────────────────────────────────────────────────────
-- 6. Verification queries (read-only — copy these to confirm migration)
-- ──────────────────────────────────────────────────────────────────────
-- SELECT client_type, COUNT(*) FROM clients GROUP BY client_type;
-- SELECT deal_side,   COUNT(*) FROM pipeline GROUP BY deal_side;
-- SELECT intake_type, COUNT(*) FROM client_intake GROUP BY intake_type;
-- SELECT COUNT(*) AS listings_rows    FROM listings;
-- SELECT COUNT(*) AS disclosures_rows FROM disclosures;
