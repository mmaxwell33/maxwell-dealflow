-- ─────────────────────────────────────────────────────────────────────────────
-- 077_broker_reminders.sql — Financing Lane Phase 2: server-side reminders.
-- A daily scheduled job nudges the broker by email when a referred client's
-- deadline is near (rate hold) or an application has stalled — because the broker
-- rarely logs in, so on-open reminders would never fire. Includes idempotency
-- (nudged_at) and a health log (automation_log) so a silently-dead job is visible.
--
-- ORDER: deploy the edge function FIRST, then run this:
--   supabase functions deploy broker-reminders
-- Apply in the Supabase SQL Editor after 076. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Reminder state on the referral
ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS app_sent_at  TIMESTAMPTZ,   -- when the broker sent his application
  ADD COLUMN IF NOT EXISTS nudged_at    TIMESTAMPTZ,   -- last reminder sent
  ADD COLUMN IF NOT EXISTS nudge_count  INT NOT NULL DEFAULT 0;

-- Health log — the FIRST failure-visibility any automation in this app has.
-- The edge function writes one row per run (service_role bypasses RLS).
CREATE TABLE IF NOT EXISTS public.automation_log (
  id             BIGSERIAL PRIMARY KEY,
  job_name       TEXT NOT NULL,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_processed INT DEFAULT 0,
  ok             BOOLEAN NOT NULL DEFAULT true,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS automation_log_job_idx ON public.automation_log (job_name, ran_at DESC);
ALTER TABLE public.automation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automation_log founder read" ON public.automation_log;
CREATE POLICY "automation_log founder read"
  ON public.automation_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agents WHERE id = auth.uid() AND created_by IS NULL));

-- Schedule: every day at 11:00 UTC (~8:30 AM Newfoundland). Run AFTER deploying
-- the broker-reminders edge function.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT cron.unschedule('broker-deadline-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broker-deadline-reminders');
SELECT cron.schedule(
  'broker-deadline-reminders',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://bxwmbrdndsetjwcexwpc.supabase.co/functions/v1/broker-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d21icmRuZHNldGp3Y2V4d3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTgzOTgsImV4cCI6MjA5MDU3NDM5OH0.zHSYjhbbZqG4Bx76Jyrjpak2mwPrkQKk42ZOBkhYkzc'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify:  SELECT jobname, schedule, active FROM cron.job WHERE jobname='broker-deadline-reminders';
-- Health:  SELECT * FROM public.automation_log ORDER BY ran_at DESC LIMIT 10;
-- Manual fire (after deploy): the net.http_post block above, run on its own.
