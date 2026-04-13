-- Migration 014: Web Push subscriptions table
-- Stores push subscription endpoints for each of Maxwell's devices
-- (Mac browser, iPhone Safari, etc.) so the edge function can reach them

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,        -- push service URL (unique per browser/device)
  p256dh      text not null,               -- client public key for payload encryption
  auth        text not null,               -- auth secret for payload encryption
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Only the owning agent can read/write their own subscriptions
alter table push_subscriptions enable row level security;

create policy "Agent manages own push subscriptions"
  on push_subscriptions for all
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid());

-- Index for fast lookup by agent
create index if not exists push_subscriptions_agent_idx on push_subscriptions(agent_id);
