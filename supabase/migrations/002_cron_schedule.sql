-- Maxwell DealFlow CRM — Phase 3: Scheduled Automation
-- Run in Supabase SQL Editor (requires pg_cron + pg_net extensions enabled)
--
-- How to enable extensions in Supabase:
--   Dashboard → Database → Extensions → search "pg_cron" → Enable
--   Dashboard → Database → Extensions → search "pg_net" → Enable
--
-- After running this migration the daily-automation function will fire
-- every day at 08:00 UTC. Adjust the cron expression if you want a
-- different time (e.g., '0 12 * * *' = 12:00 UTC = 8:00 AM ET).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add stage_updated_at to pipeline (needed for stale-deal detection)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS stage_updated_at timestamptz DEFAULT now();

-- Backfill existing rows with created_at as a reasonable default
UPDATE pipeline SET stage_updated_at = created_at WHERE stage_updated_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add related_id to activity_log (for stale-deal alert linking)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS related_id uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Schedule the daily-automation edge function via pg_cron + pg_net
--
-- Supabase projects have a built-in function `supabase_functions.http_request`
-- that wraps pg_net. We use it here to call our edge function via HTTP POST.
--
-- Replace <YOUR_PROJECT_REF> with your actual Supabase project reference ID
-- (found in Settings → General → Reference ID, e.g., "abcdefghij").
-- Replace <YOUR_ANON_KEY> with your anon/service key (or leave the Authorization
-- header as-is if your function does not require a CRON_SECRET).
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove any existing schedule with the same name (safe to re-run)
SELECT cron.unschedule('maxwell-daily-automation') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'maxwell-daily-automation'
);

-- Schedule: every day at 08:00 UTC
SELECT cron.schedule(
  'maxwell-daily-automation',              -- job name
  '0 8 * * *',                            -- cron expression: 08:00 UTC daily
  $$
  SELECT net.http_post(
    url    := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/daily-automation',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <YOUR_ANON_KEY>'
    ),
    body   := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Verify the schedule was created
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this SELECT to confirm:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'maxwell-daily-automation';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Manual test trigger (run anytime to fire immediately)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT net.http_post(
--   url    := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/daily-automation',
--   headers := jsonb_build_object(
--     'Content-Type',  'application/json',
--     'Authorization', 'Bearer <YOUR_ANON_KEY>'
--   ),
--   body   := '{}'::jsonb
-- );
-- Then check the result with: SELECT * FROM net._http_response ORDER BY id DESC LIMIT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────────────────────────────
