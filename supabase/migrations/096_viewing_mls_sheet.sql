-- 096_viewing_mls_sheet.sql
-- Book a viewing from the MLS sheet, and tell the client what the house is.
--
-- WHY:
--
-- Booking a viewing means re-keying what is already printed on the MLS sheet:
-- the address, the MLS number, the price, and whatever the seller's direction
-- says about offers. That sheet can be read the same way an offer PDF already
-- is (see migration 092 and js/offerdrop.js) — same edge function, same
-- confirm-before-save rule, pointed at a listing sheet instead of a Schedule A.
--
-- The second half is the point of the first. Buyers ask the same handful of
-- questions about every house: how old is it, how big, what style, what has
-- been replaced recently. Those facts are all on the sheet and none of them
-- reach the client today. `property_highlights` is the one short, plain-language
-- line that goes under the details table in the confirmation email.
--
-- IT IS TEXT THE AGENT HAS SEEN. The reader fills the box on the booking form;
-- Maxwell edits or clears it before he books. Nothing is written by the model
-- straight into a client's inbox.
--
-- Provenance columns mirror listing_offers: which file it was read from, when,
-- and by which model, so any figure on a viewing traces back to the page it
-- came off.
--
-- Additive only. Nothing existing changes shape or meaning.

ALTER TABLE viewings
  ADD COLUMN IF NOT EXISTS property_highlights text,
  ADD COLUMN IF NOT EXISTS mls_doc_path        text,
  ADD COLUMN IF NOT EXISTS mls_doc_name        text,
  ADD COLUMN IF NOT EXISTS mls_extracted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS mls_extraction_model text;

COMMENT ON COLUMN viewings.property_highlights IS
  'Short plain-language note about the home (age, size, style, recent updates). Shown in italics under the details table in the viewing confirmation email. Agent-edited before the booking is saved — never sent unreviewed.';
COMMENT ON COLUMN viewings.mls_doc_path IS
  'Path in the private deal-docs bucket to the MLS sheet this viewing was read from. NULL when the booking was typed in by hand.';
COMMENT ON COLUMN viewings.mls_doc_name IS
  'Original filename of that MLS sheet, for display.';
COMMENT ON COLUMN viewings.mls_extracted_at IS
  'When the sheet was read. NULL means no reader was involved.';
COMMENT ON COLUMN viewings.mls_extraction_model IS
  'Which model read the sheet, so a bad read can be traced to a model version.';
