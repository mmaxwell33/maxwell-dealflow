-- 092_offer_presentation_and_intake.sql
-- Offer presentation time + the fields an offer PDF actually carries.
--
-- WHY (two things, one migration because they land on the same screen):
--
-- 1) Offers do not trickle in. They arrive on the due date, and bidding really
--    ends at the MOMENT the offers are presented to the seller, not at midnight
--    on the deadline date. `offer_review_deadline` is a bare date, so the board
--    had no way to know that 2:00 PM was the cutoff. `offer_review_time` adds
--    the wall-clock half of that instant. Stored as plain 'HH:MM' text in the
--    agent's own local time, deliberately: this is a time Maxwell reads off a
--    listing agreement and types in, never a timestamp we do timezone maths on.
--
-- 2) Offers come in as PDFs downloaded from the showing/offer platform. Reading
--    one gives you more than an amount: the buyer, their agent, the deposit,
--    the conditions, the inspection and closing dates. Those columns did not
--    exist, so re-keying was the only option. The extraction columns below are
--    what a Schedule A actually carries, plus provenance (which file it came
--    from, when it was read) so a number can always be traced back to the page
--    it was read off.
--
-- Additive only. Nothing existing changes shape or meaning.

-- ── 1) Listings: the presentation time ──────────────────────────────────────
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS offer_review_time text;

COMMENT ON COLUMN listings.offer_review_time IS
  'Wall-clock time offers are presented to the seller, ''HH:MM'' 24h, agent local time. Bidding closes at this instant on offer_review_deadline.';

-- ── 2) Listing offers: what the document carries ────────────────────────────
ALTER TABLE listing_offers
  ADD COLUMN IF NOT EXISTS buyer_agent_email  text,
  ADD COLUMN IF NOT EXISTS buyer_agent_phone  text,
  ADD COLUMN IF NOT EXISTS brokerage          text,
  ADD COLUMN IF NOT EXISTS inspection_date    date,
  ADD COLUMN IF NOT EXISTS financing_date     date,
  ADD COLUMN IF NOT EXISTS closing_date       date,
  ADD COLUMN IF NOT EXISTS irrevocable_until  text,
  -- Provenance: which file this was read from, and when.
  ADD COLUMN IF NOT EXISTS document_path      text,
  ADD COLUMN IF NOT EXISTS document_name      text,
  ADD COLUMN IF NOT EXISTS extracted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS extraction_model   text;

COMMENT ON COLUMN listing_offers.buyer_agent_email IS
  'Where the accept / decline notice goes when the seller picks a winner.';
COMMENT ON COLUMN listing_offers.extracted_at IS
  'Set when fields were read off the PDF. NULL means typed by hand. Every extracted value is confirmed by the agent before it is saved.';
