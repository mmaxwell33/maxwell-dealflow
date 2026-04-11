-- Migration 010: Fix build_id NOT NULL constraint
-- build_id was created as NOT NULL with no default — make it auto-generate a UUID

ALTER TABLE new_builds
  ALTER COLUMN build_id SET DEFAULT gen_random_uuid();

-- Backfill any rows that somehow got a null build_id
UPDATE new_builds SET build_id = gen_random_uuid() WHERE build_id IS NULL;
