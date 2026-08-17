-- 093_sell_side_deposit.sql
-- The deposit, as an answered question rather than a date that slid past.
--
-- WHY: on a sell-side deal the two things that sink a firm sale are the deposit
-- not landing and the buyer's financing letter never arriving. Financing is
-- already an answered condition (migration 090) and reads the same from either
-- side of the deal, so it needs nothing new. The deposit had nowhere to live at
-- all: the agreed amount sits on the offer, and whether it actually reached the
-- brokerage lived only in Maxwell's memory of a phone call.
--
-- These columns mirror migration 090 exactly, so the deposit plugs into the same
-- condition strip, the same "answer now" prompt, the same amendment history, and
-- the same rule that a bar never ticks something off just because a date passed.
--
--   deposit_status        null    → not answered yet
--                         cleared → the deposit is in
--                         blocked → answered "not yet", waiting on it
--   deposit_due_date      when it is due, normally 24 hours after acceptance
--
-- Additive only.

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS deposit_due_date       date,
  ADD COLUMN IF NOT EXISTS deposit_status         text,
  ADD COLUMN IF NOT EXISTS deposit_status_at      timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_status_reason  text,
  ADD COLUMN IF NOT EXISTS deposit_status_note    text,
  ADD COLUMN IF NOT EXISTS deposit_snooze_until   date;

COMMENT ON COLUMN pipeline.deposit_status IS
  'cleared = deposit received by the brokerage. blocked = chased and not in yet. NULL = not answered. Never set by a date passing.';

-- Deals that are already finished keep reading as finished, same backfill rule
-- as migration 090: no closed deal should suddenly show an open question.
UPDATE pipeline
   SET deposit_status = COALESCE(deposit_status, 'cleared')
 WHERE stage IN ('Closed', 'Done', 'Fell Through');
