-- Migration 120: the salesperson at a vendor (e.g. Sandra at Lighting World),
-- so vendor emails open "Hi Sandra," and the name is remembered for the next
-- build. Also the kind of email last sent (intro | met | upgrade | quote).

ALTER TABLE build_selections
  ADD COLUMN IF NOT EXISTS vendor_rep        text,
  ADD COLUMN IF NOT EXISTS vendor_email_type text;

ALTER TABLE build_vendors
  ADD COLUMN IF NOT EXISTS rep text;
