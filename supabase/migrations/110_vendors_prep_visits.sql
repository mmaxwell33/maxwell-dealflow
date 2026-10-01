-- ─────────────────────────────────────────────────────────────────────────────
-- 110_vendors_prep_visits.sql
-- Prep visits: a cleaner, photographer, stager or handyman booked to work on a
-- home Maxwell is selling, filed against that property's walkthrough record.
--
--   vendors   → the people he books, saved once and picked from a list after.
--   meetings  → the visit itself, as kind = 'prep_visit', so it lands on the
--               Calendar beside viewings and appointments with no new screen.
--               builder_name / builder_email carry the vendor, client_* the
--               seller, location the address.
--   details   → units, areas, focus list, access, payment. payer and prepaid
--               live here and NEVER go into any email. They are Maxwell's
--               private record of who paid and whether it is settled.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  name        text not null,
  company     text,
  trade       text not null default 'Cleaner',
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists vendors_agent_idx on public.vendors (agent_id, trade);

alter table public.vendors enable row level security;

drop policy if exists "Agents manage own vendors" on public.vendors;
create policy "Agents manage own vendors"
  on public.vendors for all
  using      (agent_id = auth.uid())
  with check (agent_id = auth.uid());

alter table public.meetings add column if not exists walkthrough_id uuid references public.walkthroughs(id) on delete set null;
alter table public.meetings add column if not exists vendor_id      uuid references public.vendors(id) on delete set null;
alter table public.meetings add column if not exists details        jsonb;

create index if not exists meetings_walkthrough_idx on public.meetings (walkthrough_id);
