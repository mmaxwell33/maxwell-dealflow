-- 111_scheduled_send.sql
-- "Send at 9 AM" for anything in Approvals.
--
-- Gmail's API has no scheduled send, and the normal send runs in the app, so a
-- timer in the app would only fire if the app happened to be open. Instead:
--
--   1. Tapping Schedule prepares the email in the app exactly as Approve does
--      (same de-dash, disclaimer, integrity guard, click tracking) and parks
--      the finished message here: status 'Scheduled', scheduled_at, and the
--      ready-to-send payload. Staged attachments stay as storage paths.
--   2. pg_cron calls the send-scheduled edge function every 5 minutes. It
--      claims each due row (Scheduled → Sending, so two runs can never both
--      send it), sends through send-email as a system call, then records it
--      exactly like a normal approval: email_inbox, activity_log, Approved.
--      A failure goes back to Approvals as 'Failed' with a push to his phone.
--
-- Run AFTER deploying the send-scheduled function. Safe to re-run.

ALTER TABLE public.approval_queue ADD COLUMN IF NOT EXISTS scheduled_at      timestamptz;
ALTER TABLE public.approval_queue ADD COLUMN IF NOT EXISTS scheduled_payload jsonb;

CREATE INDEX IF NOT EXISTS approval_queue_scheduled_idx
  ON public.approval_queue (scheduled_at)
  WHERE status = 'Scheduled';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('maxwell-send-scheduled')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'maxwell-send-scheduled');

-- Same shape as 108: real project URL + the public anon key from config.js.
SELECT cron.schedule(
  'maxwell-send-scheduled',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://bxwmbrdndsetjwcexwpc.supabase.co/functions/v1/send-scheduled',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d21icmRuZHNldGp3Y2V4d3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTgzOTgsImV4cCI6MjA5MDU3NDM5OH0.zHSYjhbbZqG4Bx76Jyrjpak2mwPrkQKk42ZOBkhYkzc'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'maxwell-send-scheduled';
-- Recent runs:
--   SELECT status, return_message, start_time FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'maxwell-send-scheduled')
--    ORDER BY start_time DESC LIMIT 5;
