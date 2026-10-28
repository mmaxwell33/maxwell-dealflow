-- Migration 115: "Are you buying with a partner?" on the buyer intake form.
--
-- submit_intake() inserts with jsonb_populate_record(client_intake, payload), so
-- the new form keys land as soon as these columns exist. No RPC change needed.
-- Before this runs, the keys are silently ignored and the form still submits.
--
-- When Maxwell adds the intake as a client, the partner becomes a
-- client_contacts row with role 'co_buyer' (js/cobuyer.js).

ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS partner_name  text;
ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS partner_email text;
ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS partner_phone text;
