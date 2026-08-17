-- 091_listing_showings.sql
-- Showings ON Maxwell's own listings (the sell side).
--
-- WHY: `viewings` is the BUY side — Maxwell's buyer clients going to see other
-- people's homes, scoped through client_id. There has never been a record of
-- the opposite direction: other agents bringing their buyers through a house
-- Maxwell has listed. That is the one thing a seller asks about every week
-- ("who came through, what did they say"), and today it lives in Maxwell's head.
--
-- Bookings themselves happen in an external showing app. DealFlow's job is to
-- capture the confirmation in a couple of taps, keep the record, and turn it
-- into a seller-facing report that goes through the normal approval gate.
--
-- Additive only. Nothing existing changes shape.

-- ── 1) One row per showing on a listing ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_showings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             uuid NOT NULL,
  listing_id           uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,

  showing_date         date NOT NULL,
  showing_time         text,                    -- '14:30' — free text, the app owns the real slot
  brokerage            text,                    -- brokerage of the agent doing the showing
  showing_agent        text,                    -- their name, optional
  showing_agent_email  text,                    -- optional, for a future feedback request

  status               text NOT NULL DEFAULT 'booked'
                       CHECK (status IN ('booked','completed','cancelled','no_show')),
  source               text NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','app_confirmation')),

  -- Feedback, captured after the fact. Rating is the coarse signal that makes a
  -- seller report readable; feedback is what the agent actually said. Kept apart
  -- on purpose so the report can separate fact from interpretation.
  feedback             text,
  feedback_rating      text CHECK (feedback_rating IN ('interested','maybe','not_a_fit')),
  feedback_at          timestamptz,

  notes                text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_showings_listing_idx
  ON listing_showings (listing_id, showing_date DESC);
CREATE INDEX IF NOT EXISTS listing_showings_agent_idx
  ON listing_showings (agent_id);
-- Powers the brokerage autocomplete (most recently used first).
CREATE INDEX IF NOT EXISTS listing_showings_brokerage_idx
  ON listing_showings (agent_id, brokerage);

ALTER TABLE listing_showings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see only their own listing_showings" ON listing_showings;
CREATE POLICY "Agents see only their own listing_showings"
  ON listing_showings FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- ── 2) Listing-level report + deadline bookkeeping ──────────────────────────
-- last_seller_report_at  → what the next report covers ("since you last heard")
-- offer_deadline_alert_at → the deadline nudge fires once, not every refresh
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS last_seller_report_at   timestamptz,
  ADD COLUMN IF NOT EXISTS offer_deadline_alert_at timestamptz;
