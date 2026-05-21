-- ─────────────────────────────────────────────────────────────────────────────
-- 047_schedule_viewing_completion_cron.sql
-- Server-side push notifications for completed viewings.
--
-- Why: the JS poller `Notify.checkCompletedViewings()` only runs while the
-- CRM is open in a browser tab. When Maxwell's phone is locked or the app
-- is backgrounded, no push fires after a viewing ends. This migration
-- schedules the new `check-completed-viewings` edge function via pg_cron
-- so the same logic runs server-side every 5 minutes — meaning pushes
-- reach the phone even when the app is fully closed.
--
-- Run this in the Supabase SQL editor AFTER deploying the edge function:
--   supabase functions deploy check-completed-viewings
--
-- Before running:
--   1. Replace <YOUR_PROJECT_REF> with your Supabase project ref
--      (it's the subdomain of your supabase.co URL, e.g. "ovhpxbdksvxllpwsuujq")
--   2. Replace <YOUR_ANON_KEY> with your Supabase project's anon key
--      (Settings → API → anon/public key)
--   3. Ensure pg_cron and pg_net extensions are enabled
--      (Dashboard → Database → Extensions)
-- ─────────────────────────────────────────────────────────────────────────────

-- Make sure the extensions we need are enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing schedule with the same name (safe to re-run)
SELECT cron.unschedule('maxwell-check-completed-viewings') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'maxwell-check-completed-viewings'
);

-- Schedule: every 5 minutes
-- This is the right cadence — viewings have natural ~30–60 min duration
-- so a 5-minute resolution feels real-time to the agent without flooding
-- the database with checks.
SELECT cron.schedule(
  'maxwell-check-completed-viewings',
  '*/5 * * * *',                            -- every 5 minutes
  $$
  SELECT net.http_post(
    url    := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/check-completed-viewings',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <YOUR_ANON_KEY>'
    ),
    body   := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify the schedule was created
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this SELECT to confirm:
-- SELECT jobid, jobname, schedule, active
--   FROM cron.job WHERE jobname = 'maxwell-check-completed-viewings';

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual test trigger (run anytime to fire immediately, useful for debugging)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT net.http_post(
--   url    := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/check-completed-viewings',
--   headers := jsonb_build_object(
--     'Content-Type',  'application/json',
--     'Authorization', 'Bearer <YOUR_ANON_KEY>'
--   ),
--   body   := '{}'::jsonb
-- );

-- ─────────────────────────────────────────────────────────────────────────────
-- Recent invocation history (last 10 cron runs)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT job_pid, status, return_message, start_time, end_time
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'maxwell-check-completed-viewings')
--   ORDER BY start_time DESC LIMIT 10;
