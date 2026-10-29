-- Migration 117: vendor emails for new-build selections (js/vendormail.js).
--
-- Each buyer selection (migration 116) can now email its vendor: "my clients
-- are building with X, here is the floor plan, when can they come in?". The
-- emails wait until financing is approved AND the deposit to the builder is
-- submitted, then all go into Approvals at once. Maxwell can also send one
-- early. Vendor replies are matched from the inbox to show a track record.

ALTER TABLE build_selections
  ADD COLUMN IF NOT EXISTS vendor_email       text,
  ADD COLUMN IF NOT EXISTS vendor_phone       text,
  ADD COLUMN IF NOT EXISTS vendor_address     text,
  ADD COLUMN IF NOT EXISTS allowance          text,          -- "$4,500 flooring allowance", as written
  ADD COLUMN IF NOT EXISTS kind               text DEFAULT 'appendix',  -- appendix | other | price_match
  ADD COLUMN IF NOT EXISTS parent_id          uuid REFERENCES build_selections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS vendor_note        text,          -- what the clients want, put in the email
  ADD COLUMN IF NOT EXISTS vendor_files       jsonb,         -- [{path, name}] in client-docs, sent with the email
  ADD COLUMN IF NOT EXISTS vendor_approval_id uuid,          -- the approval_queue row of the vendor email
  ADD COLUMN IF NOT EXISTS vendor_queued_at   timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_sent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_replied_at  timestamptz;

ALTER TABLE new_builds
  ADD COLUMN IF NOT EXISTS deposit_submitted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS floor_plan_path           text,   -- client-docs path, the pages cut from the APS
  ADD COLUMN IF NOT EXISTS floor_plan_name           text,
  ADD COLUMN IF NOT EXISTS vendor_emails_released_at timestamptz;  -- the gate fired once

-- Vendor book: an email typed once is remembered for the next build
CREATE TABLE IF NOT EXISTS build_vendors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL,
  name       text NOT NULL,
  name_key   text NOT NULL,          -- lower(trim(name)), for matching
  email      text,
  phone      text,
  address    text,
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS build_vendors_agent_name_idx ON build_vendors(agent_id, name_key);

ALTER TABLE build_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "build_vendors_own" ON build_vendors;
CREATE POLICY "build_vendors_own" ON build_vendors
  FOR ALL
  USING      (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);
