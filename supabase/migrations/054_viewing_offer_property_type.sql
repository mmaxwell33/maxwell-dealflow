-- Migration 054: property_type on viewings + offers
--
-- Lets a viewing be flagged as a NEW BUILD at booking time. The flag rides
-- along to the offer, and when that offer is Accepted the pipeline row is
-- created with deal_type='new_build' and a new_builds construction tracker is
-- auto-created — so the deal drops straight into the New Build sequence.
--
-- Non-breaking: default 'existing_home' means every current viewing/offer
-- behaves exactly as before (regular existing-home pipeline).
-- Mirrors migration 029 which added deal_type to pipeline.

ALTER TABLE viewings
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'existing_home';

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'existing_home';

-- Sanity check
SELECT 'viewings' AS tbl, property_type, COUNT(*) AS rows FROM viewings GROUP BY property_type
UNION ALL
SELECT 'offers'   AS tbl, property_type, COUNT(*) AS rows FROM offers   GROUP BY property_type
ORDER BY tbl, property_type;
