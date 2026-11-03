-- Migration 122: the mortgage on a buyer deal. Who the lender and the mortgage
-- broker are, whether the commitment was sent for e-signing or signed (in
-- person or electronically), and every earlier lender if the first one could
-- not do it. Additive only; the deal card works without it until it is run.

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS mortgage_lender          text,
  ADD COLUMN IF NOT EXISTS mortgage_broker_company  text,
  ADD COLUMN IF NOT EXISTS mortgage_broker_name     text,
  ADD COLUMN IF NOT EXISTS mortgage_broker_email    text,
  ADD COLUMN IF NOT EXISTS mortgage_broker_phone    text,
  ADD COLUMN IF NOT EXISTS mortgage_sign_status     text,   -- null | 'sent_esign' | 'signed'
  ADD COLUMN IF NOT EXISTS mortgage_sign_method     text,   -- 'in_person' | 'electronic'
  ADD COLUMN IF NOT EXISTS mortgage_sign_date       date,
  ADD COLUMN IF NOT EXISTS mortgage_sent_date       date,
  ADD COLUMN IF NOT EXISTS mortgage_lender_history  jsonb NOT NULL DEFAULT '[]'::jsonb;
