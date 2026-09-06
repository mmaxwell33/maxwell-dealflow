-- 104_walkthrough_deficiencies.sql
-- The reason Maxwell walks the house.
--
-- WHY THIS EXISTS SEPARATELY FROM MIGRATION 101:
--
-- 101 records what the house IS: rooms, dimensions, flooring, systems. That is
-- the MLS sheet. This table records what the house NEEDS, which is a different
-- kind of fact with a different life. A room is described once and stays
-- described. A deficiency is found, photographed, priced, shown to the seller,
-- argued about, fixed or declined, and then it matters again at the offer table
-- when a buyer's inspection finds the same thing.
--
-- So a deficiency has a status of its own (open → scheduled → done / declined)
-- and outlives the walkthrough that found it.
--
-- SELLER_VISIBLE IS THE WHOLE POINT OF THE COLUMN. Most of these go to the
-- seller, because the conversation Maxwell is there to have is "here is what I
-- would fix before we list, and roughly what it costs". But some observations
-- are pricing judgement rather than repair advice, and those belong beside
-- agent_notes, not in the seller's copy. One boolean, defaulting to visible,
-- and the token function below never returns the ones turned off.
--
-- COST IS A BAND, NEVER A NUMBER. Maxwell is not a contractor and a precise
-- figure from him is a figure a seller will hold him to. A band is what he
-- actually knows standing in the room, and it is defensible six months later.
--
-- Run in the Supabase SQL Editor, AFTER 101. Safe to re-run.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The deficiency
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.walkthrough_deficiencies (
  id             uuid primary key default gen_random_uuid(),
  walkthrough_id uuid not null references public.walkthroughs(id) on delete cascade,
  agent_id       uuid not null references public.agents(id) on delete cascade,

  -- Null when it belongs to the house rather than a room: the roof, the
  -- driveway, the front steps. Set null rather than cascade on room delete, so
  -- removing a mistyped room never silently drops the defect found in it.
  room_id        uuid references public.walkthrough_rooms(id) on delete set null,

  -- Where it is, in plain words. Carried even when room_id is set, because the
  -- seller's copy reads better as "Kitchen" than as a foreign key, and because
  -- an exterior defect has an area with no room behind it.
  area           text not null,
  -- What it is. Picked from the chips in the app or typed.
  item           text not null,

  -- cosmetic | should_fix | must_fix | safety
  -- safety is separate from must_fix on purpose: it is the one that changes what
  -- Maxwell is obliged to do next, not just what he would advise.
  severity       text not null default 'should_fix',

  recommendation text,
  -- under_500 | 500_2k | 2k_10k | over_10k | unknown. See the note above.
  est_cost_band  text not null default 'unknown',

  seller_visible boolean not null default true,

  -- open | scheduled | done | declined
  status         text not null default 'open',
  status_note    text,

  sort_order     integer not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists wt_def_wt_idx   on public.walkthrough_deficiencies(walkthrough_id, sort_order);
create index if not exists wt_def_room_idx on public.walkthrough_deficiencies(room_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Photos point at the deficiency they show
-- ══════════════════════════════════════════════════════════════════════════
-- 101 already tags a photo kind='defect'. That was enough to find the defect
-- photos and not enough to say WHICH defect a photo shows, which is the only
-- thing that matters when three cracked tiles are in the same room.

alter table public.walkthrough_photos
  add column if not exists deficiency_id uuid
  references public.walkthrough_deficiencies(id) on delete set null;

create index if not exists wt_photos_def_idx on public.walkthrough_photos(deficiency_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Row level security
-- ══════════════════════════════════════════════════════════════════════════
-- Same shape as 101: the agent sees their own rows, the seller reaches theirs
-- only through the SECURITY DEFINER function in section 4.

alter table public.walkthrough_deficiencies enable row level security;

drop policy if exists wt_def_own on public.walkthrough_deficiencies;
create policy wt_def_own on public.walkthrough_deficiencies
  for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- 4. The seller's copy, by token
-- ══════════════════════════════════════════════════════════════════════════
-- Every text column cast to ::text. clients.full_name is varchar(255) and the
-- functions in 094 and 095 shipped broken for exactly this reason.
--
-- Filtered to seller_visible. status and status_note are returned because a
-- seller who has already had the furnace serviced should see that it is marked
-- done rather than read it as still outstanding and phone about it.

create or replace function public.walkthrough_defects_for_token(p_token uuid)
returns table (
  deficiency_id  uuid,
  room_id        uuid,
  area           text,
  item           text,
  severity       text,
  recommendation text,
  est_cost_band  text,
  status         text,
  status_note    text,
  sort_order     integer
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
  select d.id,
         d.room_id,
         d.area::text,
         d.item::text,
         d.severity::text,
         d.recommendation::text,
         d.est_cost_band::text,
         d.status::text,
         d.status_note::text,
         d.sort_order
  from public.walkthrough_deficiencies d
  join public.walkthroughs w on w.id = d.walkthrough_id
  where w.seller_token = p_token
    and w.sent_to_seller_at is not null   -- not readable until actually sent
    and d.seller_visible = true
  order by
    case d.severity
      when 'safety'     then 0
      when 'must_fix'   then 1
      when 'should_fix' then 2
      else 3
    end,
    d.sort_order;
end;
$$;

revoke execute on function public.walkthrough_defects_for_token(uuid) from public;
grant  execute on function public.walkthrough_defects_for_token(uuid) to anon, authenticated;
