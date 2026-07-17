-- 063: Backfill the pipeline deadline column split-brain (boardroom audit, Jul 17 2026)
--
-- History: the Viewings "log offer manually" flow wrote financing_deadline /
-- inspection_deadline, while the Offers acceptance + Save Dates flows wrote
-- financing_date / inspection_date. Readers were split the same way
-- (daily-automation + stakeholder portals read *_deadline; calendar, dashboard
-- and pipeline UI read *_date), so every deal was invisible to one half of
-- the app. The JS now dual-writes both pairs; this backfills existing rows.
--
-- NOTE: supabase db push is broken for this project (migration history out of
-- sync) — run this in the Supabase SQL Editor.

-- 1. Sizing check (run first, read-only): how many deals are half-blind?
SELECT
  count(*) FILTER (WHERE financing_deadline IS NOT NULL AND financing_date IS NULL) AS reminder_only_fin,
  count(*) FILTER (WHERE financing_date IS NOT NULL AND financing_deadline IS NULL) AS ui_only_fin,
  count(*) FILTER (WHERE inspection_deadline IS NOT NULL AND inspection_date IS NULL) AS reminder_only_ins,
  count(*) FILTER (WHERE inspection_date IS NOT NULL AND inspection_deadline IS NULL) AS ui_only_ins
FROM pipeline;

-- 2. Backfill: mirror whichever side has the value into the other.
UPDATE pipeline
SET financing_date      = COALESCE(financing_date, financing_deadline),
    financing_deadline  = COALESCE(financing_deadline, financing_date),
    inspection_date     = COALESCE(inspection_date, inspection_deadline),
    inspection_deadline = COALESCE(inspection_deadline, inspection_date)
WHERE (financing_date IS DISTINCT FROM financing_deadline)
   OR (inspection_date IS DISTINCT FROM inspection_deadline);

-- 3. Verify: both pairs should now agree everywhere (expect 0).
SELECT count(*) AS still_mismatched
FROM pipeline
WHERE (financing_date IS DISTINCT FROM financing_deadline)
   OR (inspection_date IS DISTINCT FROM inspection_deadline);

-- ------------------------------------------------------------------
-- BONUS (read-only, run while you're here) — Kwame's cron verification:
-- confirms the daily automations are actually scheduled and succeeding.
-- Do NOT copy the output of the first query anywhere public — the job
-- commands embed the anon key.
--
-- SELECT jobid, jobname, schedule, active FROM cron.job;
-- SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- BONUS 2 (read-only) — commission fee-math contamination check: rows created
-- by the old auto path took the brokerage fee on gross only. This lists rows
-- whose stored fee matches the OLD formula but not the new one (candidates
-- for a one-time recompute):
--
-- SELECT id, client_name, property_address, sale_price, gross_commission,
--        hst_collected, brokerage_fee_rate, brokerage_fees, agent_net
-- FROM commissions
-- WHERE abs(brokerage_fees - gross_commission * brokerage_fee_rate / 100) < 0.01
--   AND abs(brokerage_fees - (gross_commission + hst_collected) * brokerage_fee_rate / 100) > 0.01;
