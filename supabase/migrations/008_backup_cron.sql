-- ============================================================
-- Migration 008: Weekly Backup Cron Job
-- Schedules the backup-data edge function to run every
-- Sunday at 2:00 AM automatically.
-- ============================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing backup job if it exists
SELECT cron.unschedule('weekly-backup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weekly-backup'
);

-- Schedule: every Sunday at 2:00 AM UTC
SELECT cron.schedule(
  'weekly-backup',
  '0 2 * * 0',  -- minute hour day month weekday (0 = Sunday)
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/backup-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
