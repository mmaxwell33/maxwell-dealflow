-- 113_sale_condition_and_comm_style.sql
-- Two things a buy-and-sell client needs that had nowhere to live.
--
-- 1. SALE OF THE BUYER'S PROPERTY (Schedule A). A buyer who must sell first
--    signs an offer conditional on that sale. The condition used to sit in the
--    offer's free-text "conditions" box with no date, so nothing reminded
--    Maxwell when it was due. These columns mirror migrations 090 and 093
--    exactly, so "sale" plugs into the same condition strip, the same "needs
--    your answer" prompt, the same amendment history, and the same rule that a
--    condition is never ticked off just because a date passed.
--
--      sale_condition_date   when the buyer's own home must be sold firm
--      sale_status           null → not answered, cleared → sold firm,
--                            blocked → answered "not yet"
--
-- 2. COMMUNICATION STYLE. How a client likes to be written to. It is a style,
--    not an age, on purpose: the record never labels a person "older".
--      standard → the email as written
--      plain    → plain and detailed: short sentences, no jargon, step by step
--      brief    → brief and quick: the point first, nothing extra
--
-- Additive only. Safe to run twice.

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS sale_condition_date date;

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS sale_condition_date  date,
  ADD COLUMN IF NOT EXISTS sale_status          text,
  ADD COLUMN IF NOT EXISTS sale_status_at       timestamptz,
  ADD COLUMN IF NOT EXISTS sale_status_reason   text,
  ADD COLUMN IF NOT EXISTS sale_status_note     text,
  ADD COLUMN IF NOT EXISTS sale_snooze_until    date;

COMMENT ON COLUMN pipeline.sale_status IS
  'cleared = the buyer''s own home sold firm. blocked = chased and not sold yet. NULL = not answered. Never set by a date passing.';

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS comm_style text NOT NULL DEFAULT 'standard';

DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_comm_style_check
    CHECK (comm_style IN ('standard','plain','brief'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Finished deals keep reading as finished (same backfill rule as 090 / 093).
UPDATE pipeline
   SET sale_status = COALESCE(sale_status, 'cleared')
 WHERE stage IN ('Closed', 'Done', 'Fell Through')
   AND sale_condition_date IS NOT NULL;
