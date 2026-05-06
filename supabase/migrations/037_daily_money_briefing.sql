-- 037_daily_money_briefing.sql
-- Storage + table + cron schedule for the daily-briefing edge function.
--
-- BEFORE RUNNING:
--   1. Replace <YOUR_PROJECT_REF> below with your Supabase project reference
--      (e.g., 'bxwmbrdndsetjwcexwpc'). Find it in Settings → General → Reference ID.
--   2. Replace <YOUR_SERVICE_KEY> with your service-role key from Settings → API.
--      (Service key, not anon key — the function needs to send email and write to storage.)

-- ── 1. briefings table (stores each day's brief for archive + replay) ──
CREATE TABLE IF NOT EXISTS public.briefings (
  date date PRIMARY KEY,
  snapshot           jsonb,
  stories            jsonb,
  etf_call           jsonb,
  action_item        jsonb,
  watch_list         jsonb,
  audit_footer       text,
  written_brief_html text,
  spoken_script_text text,
  mp3_url            text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- RLS — only service role writes; agent can read for archive view
ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "briefings_read_authenticated" ON public.briefings;
CREATE POLICY "briefings_read_authenticated"
  ON public.briefings FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── 2. Public storage bucket for the daily MP3 ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('briefings-audio', 'briefings-audio', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (Albert opens MP3 from email link)
DROP POLICY IF EXISTS "briefings_audio_public_read" ON storage.objects;
CREATE POLICY "briefings_audio_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'briefings-audio');

-- Service-role write (only the edge function uploads here)
DROP POLICY IF EXISTS "briefings_audio_service_insert" ON storage.objects;
CREATE POLICY "briefings_audio_service_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'briefings-audio' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "briefings_audio_service_update" ON storage.objects;
CREATE POLICY "briefings_audio_service_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'briefings-audio' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'briefings-audio' AND auth.role() = 'service_role');

-- ── 3. Daily cron schedule ──
-- 09:00 UTC = ~06:30 NDT (May–Oct) / ~05:30 NST (Nov–Apr).
-- Brief generation takes ~30 seconds, so the email lands ~6:31 NDT, ~5:31 NST.

SELECT cron.unschedule('daily-money-briefing') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-money-briefing'
);

SELECT cron.schedule(
  'daily-money-briefing',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 4. Verify ──
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'daily-money-briefing';

-- ── 5. Manual test trigger (run after deploying the edge function) ──
-- SELECT net.http_post(
--   url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/daily-briefing',
--   headers := jsonb_build_object(
--     'Content-Type',  'application/json',
--     'Authorization', 'Bearer <YOUR_SERVICE_KEY>'
--   ),
--   body    := '{}'::jsonb
-- );
-- Then watch the response: SELECT * FROM net._http_response ORDER BY id DESC LIMIT 1;
