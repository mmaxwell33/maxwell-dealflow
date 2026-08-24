-- 098_viewing_listing_remarks.sql
-- Keep the listing's own description on the viewing, for the agent only.
--
-- WHY:
--
-- The prose block on an MLS sheet (Matrix heads it "Property Overview";
-- elsewhere it is "Remarks" or "Public Remarks") carries things no labelled
-- field does: what was renovated and when, what the layout is actually like,
-- what the seller is drawing attention to. Today it lives only in a PDF on
-- Maxwell's desktop, so by the time he is standing at the door it is gone.
--
-- THIS COLUMN IS NOT CLIENT FACING, and that is the whole point of keeping it
-- separate from property_highlights (migration 096). Those remarks are the
-- LISTING BROKERAGE'S copyrighted marketing copy. Reproducing them in an email
-- Maxwell sends is not his to do, and it would also mean forwarding the
-- seller's sales pitch to his own buyer, which is the wrong side of the table.
-- property_highlights is what the client reads: Maxwell's own short note,
-- written fresh and reviewed before the booking saves. This column is what
-- Maxwell reads, verbatim, on the viewing detail.
--
-- Additive only. Nothing existing changes shape or meaning.

ALTER TABLE viewings
  ADD COLUMN IF NOT EXISTS listing_remarks text;

COMMENT ON COLUMN viewings.listing_remarks IS
  'The listing description verbatim from the MLS sheet. AGENT-FACING ONLY: this is the listing brokerage''s copyrighted copy and must never be sent to a client. What the client reads is property_highlights, which is written fresh and reviewed before the booking is saved.';
