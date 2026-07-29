-- ─────────────────────────────────────────────────────────────────────────────
-- 084_appointment_meetings.sql
-- Extend the `meetings` table so it can also hold client APPOINTMENTS — meeting a
-- client at one or more locations to pick out finishes (flooring, cabinets,
-- countertops, etc). Same table, same RLS; a `kind` discriminator separates
-- 'builder' meetings from 'appointment's, and `stops` holds the ordered list of
-- {type, address, time} the client should meet you at. `purpose` is a short
-- summary used on the calendar + email subject.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS kind    TEXT NOT NULL DEFAULT 'builder';
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS stops   JSONB;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS purpose TEXT;
