-- 108_fix_daily_automation_cron.sql
-- The daily job that was scheduled but never ran.
--
-- Migration 002 scheduled daily-automation with the literal placeholders
-- '<YOUR_PROJECT_REF>' and '<YOUR_ANON_KEY>' still in the URL and header. The
-- cron entry exists and fires every morning, and every morning it posts to a
-- host that does not exist. So none of what daily-automation does has ever
-- happened on its own: the three-day and one-day financing reminders to the
-- client, the inspection reminders, the walkthrough and closing-day emails.
--
-- It matters more now, because daily-automation is also what asks Maxwell on
-- his phone, from the financing deadline onward, whether financing came
-- through. That question is the trigger for releasing the lawyer email. A
-- scheduler pointed at nowhere means the question is never asked.
--
-- Same shape as the jobs that DO work (053 morning briefing, 077 broker
-- reminders): the real project URL and the anon key. The key is the public one
-- already shipped in config.js, not a secret.
--
-- Schedule moves from 08:00 UTC (5:30 AM in St. John's) to 11:30 UTC (9:00 AM
-- in St. John's during daylight time), so the financing question lands at the
-- start of his day rather than before it.
--
-- Run AFTER deploying the updated daily-automation and send-push functions.
-- Safe to re-run.
--
-- Migration 047 (check-completed-viewings) has the same placeholder problem.
-- It is left alone here because it is a separate feature; see the note at the
-- bottom for the one-line fix if you want it too.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('maxwell-daily-automation')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'maxwell-daily-automation');

SELECT cron.schedule(
  'maxwell-daily-automation',
  '30 11 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://bxwmbrdndsetjwcexwpc.supabase.co/functions/v1/daily-automation',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d21icmRuZHNldGp3Y2V4d3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTgzOTgsImV4cCI6MjA5MDU3NDM5OH0.zHSYjhbbZqG4Bx76Jyrjpak2mwPrkQKk42ZOBkhYkzc'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify it is scheduled:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'maxwell-daily-automation';
--
-- See whether it actually ran and what came back (after 11:30 UTC):
--   SELECT status, return_message, start_time FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'maxwell-daily-automation')
--    ORDER BY start_time DESC LIMIT 5;
--
-- Fire it once by hand, right now, to test: run the SELECT net.http_post(...)
-- block above on its own.
--
-- OPTIONAL, the same fix for check-completed-viewings (migration 047): replace
-- '<YOUR_PROJECT_REF>' with 'bxwmbrdndsetjwcexwpc' and '<YOUR_ANON_KEY>' with the
-- key above in that migration's cron.schedule block, and run it.
