-- 026_pipeline_archived_at.sql
-- Adds soft-archive support to the pipeline table.
-- Active pipeline rows have archived_at IS NULL.
-- Archived rows have a timestamp; they can be restored (set null) or hard-deleted.

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Partial index keeps the active-deals query fast even after lots of archived rows.
CREATE INDEX IF NOT EXISTS idx_pipeline_active
  ON pipeline (agent_id, created_at DESC)
  WHERE archived_at IS NULL;

-- Secondary index for the archive view.
CREATE INDEX IF NOT EXISTS idx_pipeline_archived
  ON pipeline (agent_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;
