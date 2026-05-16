-- Maxwell DealFlow — Migration 044
-- Phase 2.A PR #5b — security/claude-chat-rate-limit
--
-- Closes AUDIT_REPORT.md §1.6.2 (P1):
--   claude-chat forwards every authenticated message to Anthropic with
--   max_tokens=1500. One compromised agent session = unbounded Anthropic
--   spend on Maxwell's API key. No cap exists today.
--
-- Mirrors the email_rate_limit pattern from migration 017:
--   - One row per agent per hour bucket.
--   - Atomic INSERT … ON CONFLICT increment that returns the new count.
--   - Service-role-only access (RLS denies anon/authenticated).
--   - Nightly cleanup of rows older than 7 days.
--
-- Limit: 60 messages per agent per hour. Generous for normal usage
-- (one message per minute), tight enough to bound runaway costs.

CREATE TABLE IF NOT EXISTS public.claude_rate_limit (
  agent_id      uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start  timestamptz   NOT NULL,
  count         int           NOT NULL DEFAULT 0,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, window_start)
);

ALTER TABLE public.claude_rate_limit ENABLE ROW LEVEL SECURITY;
-- No policies — service role bypasses RLS. Anon/authenticated have no access.

CREATE OR REPLACE FUNCTION public.increment_claude_rate_limit(
  p_agent_id     uuid,
  p_window_start timestamptz
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO public.claude_rate_limit AS r (agent_id, window_start, count, updated_at)
    VALUES (p_agent_id, p_window_start, 1, now())
  ON CONFLICT (agent_id, window_start)
    DO UPDATE SET count = r.count + 1, updated_at = now()
  RETURNING count INTO new_count;

  RETURN new_count;
END
$$;

CREATE OR REPLACE FUNCTION public.cleanup_claude_rate_limit()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.claude_rate_limit
   WHERE window_start < now() - interval '7 days';
$$;

-- Schedule nightly cleanup at 03:15 UTC (15 min offset from email cleanup
-- to avoid both running at the same instant).
SELECT cron.schedule(
  'claude-rate-limit-cleanup',
  '15 3 * * *',
  $$SELECT public.cleanup_claude_rate_limit();$$
);
