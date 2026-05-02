-- Maxwell DealFlow — Phase 1 of New Builds → Pipeline merge
-- Adds deal_type column to pipeline and backfills existing build rows.
-- Run in Supabase SQL Editor.
--
-- After this migration:
--   • Every pipeline row has a deal_type flag ('existing_home' default, 'new_build' for builds)
--   • Existing rows created by NewBuilds.syncPipeline() (pipeline_id like 'BUILD-%') are
--     retroactively tagged 'new_build'
--   • New build rows inserted going forward will be tagged via js/extras.js syncPipeline()
--
-- This migration is non-breaking: pipeline render code that ignores deal_type
-- continues to work exactly as before. Phase 2 will add UI differentiation.

ALTER TABLE pipeline
  ADD COLUMN IF NOT EXISTS deal_type text NOT NULL DEFAULT 'existing_home';

-- Backfill: any pipeline row whose pipeline_id starts with 'BUILD-'
-- was created by NewBuilds.syncPipeline() — flag it as a new_build.
UPDATE pipeline
SET    deal_type = 'new_build'
WHERE  deal_type = 'existing_home'
  AND  pipeline_id LIKE 'BUILD-%';

-- Verify the split
SELECT deal_type, COUNT(*) AS rows
FROM pipeline
GROUP BY deal_type
ORDER BY deal_type;
