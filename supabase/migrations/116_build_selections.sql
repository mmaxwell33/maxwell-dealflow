-- Migration 116: buyer selections on a new build (js/selections.js).
--
-- The builder's appendix to a new build APS lists the appointments the buyers
-- must make themselves: choose flooring, cabinets, countertops, colours and so
-- on, each with a vendor and a date. One row per selection. The APS reader
-- fills them, Maxwell can add or edit them by hand, the buyers get them in
-- their congratulations email, and a daily check reminds them until Maxwell
-- marks each one done (which also ticks the matching checklist step, e.g.
-- "Flooring picked up").

CREATE TABLE IF NOT EXISTS build_selections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         uuid NOT NULL,
  build_id         uuid NOT NULL REFERENCES new_builds(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  item             text NOT NULL,                 -- "Flooring", "Kitchen cabinets", ...
  vendor_name      text,
  vendor_contact   text,                          -- phone, email or address as written
  details          text,                          -- what they choose there, in a line or two
  due_date         date,                          -- must be done by
  appointment_date date,                          -- once booked
  status           text NOT NULL DEFAULT 'to_book'
                   CHECK (status IN ('to_book','booked','done')),
  done_at          timestamptz,
  last_reminder    text,                          -- '7d' | '2d' | 'appt' | 'overdue'
  last_reminded_at timestamptz,
  source           text DEFAULT 'manual',         -- manual | aps
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS build_selections_build_idx ON build_selections(build_id);
CREATE INDEX IF NOT EXISTS build_selections_agent_idx ON build_selections(agent_id);

ALTER TABLE build_selections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "build_selections_own" ON build_selections;
CREATE POLICY "build_selections_own" ON build_selections
  FOR ALL
  USING      (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);
