-- 101_listing_walkthroughs.sql
-- The listing appointment, recorded in the seller's own file.
--
-- WHY:
--
-- Maxwell walks a house once, on a notepad, and then rebuilds it from memory
-- hours later at a keyboard. What gets lost is never the address. It is the
-- burn mark on the counter, the year the roof was done, and whether the
-- basement counts toward the square footage. This holds all of it, captured
-- while he is standing in the room.
--
-- THE POINT IS THE SELLER LINK. A walkthrough belongs to a client row, so it
-- lands in Rosalind's file and is still there next spring. Everything else here
-- exists to serve that: the rooms, the photos, and the record of what she
-- confirmed.
--
-- THE REVIEW LOOP. The seller reads the property record on a token link, the
-- same no-login pattern as the intake and portal pages, and can correct any
-- line or add what was missed. Her corrections arrive as PROPOSALS, never as
-- overwrites: walkthrough_seller_edits keeps both values side by side and
-- Maxwell decides which stands. Then he certifies, which stamps his name and
-- the time, and the MLS entry is built from the certified version.
--
-- That certified, seller-confirmed record is also evidence of what was
-- disclosed and when, which is worth more than the time it saves.
--
-- NOT STORED HERE: room dimensions are never derived from a photograph. There
-- is no reliable way to measure a room from an image without a known reference
-- in frame, and a wrong number on an MLS sheet is Maxwell's signature on a
-- wrong number. dimension_source records where each measurement actually came
-- from, so a figure read off an old MLS sheet is never mistaken for one he took
-- himself.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The walkthrough
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.walkthroughs (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references public.agents(id) on delete cascade,
  -- The whole reason this table exists. Nullable only so a walkthrough can be
  -- started at the door before the seller has been picked; the app requires it
  -- before the report can be sent.
  client_id          uuid references public.clients(id) on delete set null,
  listing_id         uuid references public.listings(id) on delete set null,

  property_address   text not null,
  property_type      text,                    -- detached / semi / condo / townhouse / other
  year_built         integer,

  -- draft → sent_to_seller → seller_reviewed → certified
  status             text not null default 'draft',

  -- Systems and exterior. One jsonb rather than twenty columns because the list
  -- of things worth recording changes with the house (a well and septic matter
  -- outside town and never in it), and a schema change per question is how this
  -- would stop being useful.
  systems            jsonb not null default '{}'::jsonb,

  summary            text,                    -- the written condition summary
  agent_notes        text,                    -- PRIVATE. Never leaves the app.

  -- The seller's review link. Random, unguessable, and revocable by nulling it.
  seller_token       uuid unique default gen_random_uuid(),
  sent_to_seller_at  timestamptz,
  seller_reviewed_at timestamptz,

  -- Certification. Once set, the app treats the record as the source for the
  -- listing and tracks later edits against it.
  certified_at       timestamptz,
  certified_by       uuid references public.agents(id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists walkthroughs_agent_idx  on public.walkthroughs(agent_id);
create index if not exists walkthroughs_client_idx on public.walkthroughs(client_id);
create index if not exists walkthroughs_token_idx  on public.walkthroughs(seller_token);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Rooms
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.walkthrough_rooms (
  id               uuid primary key default gen_random_uuid(),
  walkthrough_id   uuid not null references public.walkthroughs(id) on delete cascade,
  agent_id         uuid not null references public.agents(id) on delete cascade,

  room_name        text not null,             -- "Kitchen", "Primary bedroom"
  room_type        text,                      -- drives which feature chips show

  -- Stored as numerics in feet so they can be totalled and compared. The app
  -- shows feet and inches; 14 feet 6 inches is 14.5 here.
  length_ft        numeric(6,2),
  width_ft         numeric(6,2),
  -- typed | mls_sheet | measured. See the note at the top: this is how a figure
  -- carried over from an old listing stays distinguishable from a measured one.
  dimension_source text,

  condition        text,                      -- excellent / good / fair / needs work
  flooring         text,
  features         text[] not null default '{}',
  note             text,
  sort_order       integer not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists wt_rooms_wt_idx on public.walkthrough_rooms(walkthrough_id, sort_order);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Photos
-- ══════════════════════════════════════════════════════════════════════════
-- Files live in the private listing-photos bucket (section 6). Only the path is
-- stored here. room_id is null for exterior and systems shots, which belong to
-- the house rather than to any one room.

create table if not exists public.walkthrough_photos (
  id             uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null references public.walkthroughs(id) on delete cascade,
  room_id        uuid references public.walkthrough_rooms(id) on delete cascade,
  agent_id       uuid not null references public.agents(id) on delete cascade,
  storage_path   text not null,
  caption        text,
  kind           text,                        -- room | exterior | system | defect
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists wt_photos_wt_idx   on public.walkthrough_photos(walkthrough_id, sort_order);
create index if not exists wt_photos_room_idx on public.walkthrough_photos(room_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. What the seller changed
-- ══════════════════════════════════════════════════════════════════════════
-- Both values are kept. This is deliberately not an edit log of a mutable
-- record: it is the seller's account beside the agent's, with the resolution
-- recorded. That is what makes the certified version defensible later.

create table if not exists public.walkthrough_seller_edits (
  id             uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null references public.walkthroughs(id) on delete cascade,
  agent_id       uuid not null references public.agents(id) on delete cascade,
  room_id        uuid references public.walkthrough_rooms(id) on delete cascade,

  field_label    text not null,               -- "Roof year", shown as written
  agent_value    text,
  seller_value   text,
  seller_comment text,

  -- pending | accepted | rejected. Nothing is applied until Maxwell resolves it.
  resolution     text not null default 'pending',
  resolved_at    timestamptz,

  created_at     timestamptz not null default now()
);

create index if not exists wt_edits_wt_idx on public.walkthrough_seller_edits(walkthrough_id, resolution);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Row level security
-- ══════════════════════════════════════════════════════════════════════════
-- Same shape as the rest of DealFlow: an agent sees their own rows and nothing
-- else. The seller reaches their review through the SECURITY DEFINER functions
-- in section 7, never through these tables directly.

alter table public.walkthroughs             enable row level security;
alter table public.walkthrough_rooms        enable row level security;
alter table public.walkthrough_photos       enable row level security;
alter table public.walkthrough_seller_edits enable row level security;

drop policy if exists walkthroughs_own on public.walkthroughs;
create policy walkthroughs_own on public.walkthroughs
  for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

drop policy if exists wt_rooms_own on public.walkthrough_rooms;
create policy wt_rooms_own on public.walkthrough_rooms
  for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

drop policy if exists wt_photos_own on public.walkthrough_photos;
create policy wt_photos_own on public.walkthrough_photos
  for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

drop policy if exists wt_edits_own on public.walkthrough_seller_edits;
create policy wt_edits_own on public.walkthrough_seller_edits
  for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- 6. Photo storage
-- ══════════════════════════════════════════════════════════════════════════
-- Private, following migration 065. Sixty photos per house would bury a
-- client's actual documents in client-docs, so they get their own bucket.
-- Paths are agent_id/walkthrough_id/filename, and the policies below are what
-- make that prefix meaningful rather than decorative.

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', false)
on conflict (id) do nothing;

drop policy if exists listing_photos_own on storage.objects;
create policy listing_photos_own on storage.objects
  for all
  using      (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ══════════════════════════════════════════════════════════════════════════
-- 7. The seller's review, by token
-- ══════════════════════════════════════════════════════════════════════════
-- EVERY text column is cast to ::text. clients.full_name is varchar(255) and
-- the two functions in migrations 094 and 095 declared it as text without
-- casting, so both failed on every call from the day they shipped and reported
-- it to the client as "check your spelling". That is not repeated here.
--
-- agent_notes is never selected. The seller sees the property record and not
-- Maxwell's working notes, which is the whole reason those are a separate
-- column rather than a section of the summary.

create or replace function public.resolve_walkthrough_token(p_token uuid)
returns table (
  walkthrough_id   uuid,
  property_address text,
  property_type    text,
  year_built       integer,
  systems          jsonb,
  summary          text,
  agent_name       text,
  agent_email      text,
  seller_name      text,
  status           text,
  certified_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null then
    return;
  end if;

  return query
  select w.id,
         w.property_address::text,
         w.property_type::text,
         w.year_built,
         w.systems,
         w.summary::text,
         a.full_name::text,
         a.email::text,
         c.full_name::text,
         w.status::text,
         w.certified_at
  from public.walkthroughs w
  join public.agents a on a.id = w.agent_id
  left join public.clients c on c.id = w.client_id
  where w.seller_token = p_token
    and w.sent_to_seller_at is not null   -- not readable until actually sent
  limit 1;
end;
$$;

revoke execute on function public.resolve_walkthrough_token(uuid) from public;
grant  execute on function public.resolve_walkthrough_token(uuid) to anon, authenticated;

-- ── The rooms behind that token ───────────────────────────────────────────

create or replace function public.walkthrough_rooms_for_token(p_token uuid)
returns table (
  room_id    uuid,
  room_name  text,
  length_ft  numeric,
  width_ft   numeric,
  condition  text,
  flooring   text,
  features   text[],
  sort_order integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null then
    return;
  end if;

  return query
  select r.id,
         r.room_name::text,
         r.length_ft,
         r.width_ft,
         r.condition::text,
         r.flooring::text,
         r.features,
         r.sort_order
  from public.walkthrough_rooms r
  join public.walkthroughs w on w.id = r.walkthrough_id
  where w.seller_token = p_token
    and w.sent_to_seller_at is not null
  order by r.sort_order;
  -- r.note is deliberately absent. Room notes are Maxwell's, not the seller's.
end;
$$;

revoke execute on function public.walkthrough_rooms_for_token(uuid) from public;
grant  execute on function public.walkthrough_rooms_for_token(uuid) to anon, authenticated;

-- ── The seller's corrections, written back ────────────────────────────────
-- Writes only to walkthrough_seller_edits, and only ever as 'pending'. The
-- token holder cannot change a single value on the walkthrough itself, which is
-- what keeps "she reviewed it" and "he certified it" two separate facts.

create or replace function public.submit_walkthrough_review(
  p_token   uuid,
  p_edits   jsonb,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wt      uuid;
  v_agent   uuid;
  v_item    jsonb;
  v_count   integer := 0;
begin
  if p_token is null then
    return jsonb_build_object('ok', false);
  end if;

  select w.id, w.agent_id into v_wt, v_agent
  from public.walkthroughs w
  where w.seller_token = p_token
    and w.sent_to_seller_at is not null
    and w.certified_at is null            -- a certified record is closed
  limit 1;

  if v_wt is null then
    return jsonb_build_object('ok', false);
  end if;

  -- Replace this seller's previous unresolved pass so a second submission does
  -- not stack duplicates. Anything Maxwell already resolved is left alone.
  delete from public.walkthrough_seller_edits
   where walkthrough_id = v_wt and resolution = 'pending';

  if jsonb_typeof(p_edits) = 'array' then
    for v_item in select * from jsonb_array_elements(p_edits)
    loop
      insert into public.walkthrough_seller_edits
        (walkthrough_id, agent_id, room_id, field_label,
         agent_value, seller_value, seller_comment)
      values
        (v_wt, v_agent,
         nullif(v_item->>'room_id','')::uuid,
         left(coalesce(v_item->>'field_label','Note'), 120),
         left(coalesce(v_item->>'agent_value',''), 500),
         left(coalesce(v_item->>'seller_value',''), 500),
         left(coalesce(v_item->>'seller_comment',''), 2000));
      v_count := v_count + 1;
    end loop;
  end if;

  if nullif(trim(coalesce(p_comment,'')), '') is not null then
    insert into public.walkthrough_seller_edits
      (walkthrough_id, agent_id, field_label, seller_comment)
    values (v_wt, v_agent, 'General comment', left(p_comment, 2000));
    v_count := v_count + 1;
  end if;

  update public.walkthroughs
     set seller_reviewed_at = now(),
         status = 'seller_reviewed',
         updated_at = now()
   where id = v_wt;

  return jsonb_build_object('ok', true, 'edits', v_count);
end;
$$;

revoke execute on function public.submit_walkthrough_review(uuid, jsonb, text) from public;
grant  execute on function public.submit_walkthrough_review(uuid, jsonb, text) to anon, authenticated;
