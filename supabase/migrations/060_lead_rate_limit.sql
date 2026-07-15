-- 060_lead_rate_limit.sql
-- Backs the server-side rate limit for the public website Contact form.
-- notify-lead counts recent rows per IP before it emails Maxwell, so the
-- form can't be scripted to flood his real Gmail (the sender the whole CRM
-- depends on). Service-role only: RLS is ON with NO policies, so anon and
-- authenticated clients cannot read or write it — only the edge function
-- (service role) touches it.

create table if not exists public.lead_rate_limit (
  id         bigserial primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);

create index if not exists lead_rate_limit_ip_time
  on public.lead_rate_limit (ip, created_at);

alter table public.lead_rate_limit enable row level security;
-- (no policies on purpose → locked to the service role)

-- Optional housekeeping: drop rows older than a day so the table stays tiny.
-- Runs only if pg_cron is available; harmless to skip otherwise.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'lead_rate_limit_cleanup',
      '17 3 * * *',
      $q$ delete from public.lead_rate_limit where created_at < now() - interval '1 day' $q$
    );
  end if;
end $$;
