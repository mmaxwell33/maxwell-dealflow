-- Maxwell DealFlow CRM — Migration 017
-- Persistent per-agent email rate limit (replaces in-memory Map in send-email edge function).
--
-- Why: the old limiter lived inside the Deno process. Every cold start wiped
-- the counter, which meant the 60/hour cap was effectively unenforced.
-- Storing counters in Postgres survives cold starts and gives us a trail to
-- audit abuse / debug Gmail throttling complaints.
--
-- Safety notes:
--   • Rows are keyed by agent_id + hour bucket — one row per agent per hour.
--   • Service-role only (the edge function uses SUPABASE_SERVICE_ROLE_KEY).
--   • Authenticated users cannot read or write this table.
--   • Old rows auto-purge after 7 days via the cleanup function.

create table if not exists public.email_rate_limit (
  agent_id       uuid          not null references auth.users(id) on delete cascade,
  window_start   timestamptz   not null,   -- start of the 1-hour bucket
  count          int           not null default 0,
  updated_at     timestamptz   not null default now(),
  primary key (agent_id, window_start)
);

-- Lock the table down. Only the service role (used by edge functions) can touch it.
alter table public.email_rate_limit enable row level security;

-- No SELECT / INSERT / UPDATE / DELETE policies = no access for anon/authenticated roles.
-- The service role bypasses RLS by design, which is what we want here.

-- Atomic "increment and return the new count" function. The edge function calls
-- this once per send attempt. If it returns a count > 60, the edge function blocks.
create or replace function public.increment_email_rate_limit(
  p_agent_id uuid,
  p_window_start timestamptz
) returns int
language plpgsql
security definer
as $$
declare
  new_count int;
begin
  insert into public.email_rate_limit as e (agent_id, window_start, count, updated_at)
    values (p_agent_id, p_window_start, 1, now())
  on conflict (agent_id, window_start)
    do update set count = e.count + 1, updated_at = now()
  returning count into new_count;

  return new_count;
end
$$;

-- Nightly cleanup — keep the table small. Runs via pg_cron in supabase/migrations.
create or replace function public.cleanup_email_rate_limit()
returns void
language sql
security definer
as $$
  delete from public.email_rate_limit
   where window_start < now() - interval '7 days';
$$;

-- Schedule the cleanup once a day at 03:10 UTC.
-- (pg_cron is already enabled on this project — see migration 008.)
select cron.schedule(
  'email-rate-limit-cleanup',
  '10 3 * * *',
  $$select public.cleanup_email_rate_limit();$$
);
