-- ─────────────────────────────────────────────────────────────────────────────
-- 053_schedule_morning_briefing.sql
-- Schedule the daily "☀️ Good Morning, Maxwell" summary email.
--
-- Why: the `morning-briefing` edge function was deployed and works, but it was
-- never scheduled — there was no pg_cron job calling it. So the morning summary
-- email never went out. This migration adds the missing schedule, matching the
-- pattern used for daily-automation (002), daily-briefing (037) and
-- check-completed-viewings (047).
--
-- Run this in the Supabase SQL editor AFTER the edge function is deployed:
--   supabase functions deploy morning-briefing
--
-- Project ref and anon key below are already filled in for this project
-- (bxwmbrdndsetjwcexwpc). Ensure pg_cron and pg_net are enabled
-- (Dashboard → Database → Extensions).
--
-- IMPORTANT — the function also needs these Supabase secrets set, or it will
-- send nothing:
--   AGENT_EMAIL (or GMAIL_USER)  → where the briefing is sent
--   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN → Gmail send
-- (These are the same Gmail creds send-email already uses.)
-- ─────────────────────────────────────────────────────────────────────────────

-- Make sure the extensions we need are enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing schedule with the same name (safe to re-run)
SELECT cron.unschedule('maxwell-morning-briefing') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'maxwell-morning-briefing'
);

-- Schedule: every day at 10:30 UTC.
-- Newfoundland is UTC-2:30 (summer / NDT) to UTC-3:30 (winter / NST), so
-- 10:30 UTC lands at ~8:00 AM (summer) / ~7:00 AM (winter) local — a sensible
-- "first thing in the morning" delivery time. Adjust the hour if you prefer.
SELECT cron.schedule(
  'maxwell-morning-briefing',
  '30 10 * * *',                            -- 10:30 UTC daily
  $$
  SELECT net.http_post(
    url    := 'https://bxwmbrdndsetjwcexwpc.supabase.co/functions/v1/morning-briefing',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d21icmRuZHNldGp3Y2V4d3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTgzOTgsImV4cCI6MjA5MDU3NDM5OH0.zHSYjhbbZqG4Bx76Jyrjpak2mwPrkQKk42ZOBkhYkzc'
    ),
    body   := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify the schedule was created
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT jobid, jobname, schedule, active
--   FROM cron.job WHERE jobname = 'maxwell-morning-briefing';

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual test trigger (run anytime to fire the briefing immediately)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT net.http_post(
--   url    := 'https://bxwmbrdndsetjwcexwpc.supabase.co/functions/v1/morning-briefing',
--   headers := jsonb_build_object(
--     'Content-Type',  'application/json',
--     'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d21icmRuZHNldGp3Y2V4d3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTgzOTgsImV4cCI6MjA5MDU3NDM5OH0.zHSYjhbbZqG4Bx76Jyrjpak2mwPrkQKk42ZOBkhYkzc'
--   ),
--   body   := '{}'::jsonb
-- );

-- ─────────────────────────────────────────────────────────────────────────────
-- Recent invocation history (last 10 cron runs — for debugging)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT status, return_message, start_time, end_time
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'maxwell-morning-briefing')
--   ORDER BY start_time DESC LIMIT 10;
