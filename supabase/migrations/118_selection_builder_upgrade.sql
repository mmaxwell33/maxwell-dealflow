-- Migration 118: buyer selections the builder already chose, and upgrades.
--
-- picked_by = 'builder' marks a selection the builder made (standard siding
-- colour, standard door): it counts as done, so no reminders and no vendor
-- email. upgrade_note records an upgrade the buyers took on that selection
-- ("Hardwood on main floor, +$3,200"), which Maxwell corrects by hand.

ALTER TABLE build_selections
  ADD COLUMN IF NOT EXISTS picked_by    text,   -- null (buyers) | 'builder'
  ADD COLUMN IF NOT EXISTS upgrade_note text,
  ADD COLUMN IF NOT EXISTS allowance_hst text;  -- 'included' | 'plus' | null (not stated)
