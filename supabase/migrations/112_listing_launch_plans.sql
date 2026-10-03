-- ─────────────────────────────────────────────────────────────────────────────
-- 112_listing_launch_plans.sql
-- The launch plan: everything done to get one home ready to list, who does each
-- thing, when, and the seller's signed OK to go ahead with photos.
--
--   listing_launch_plans  → one per property file (walkthrough). Units and their
--                           occupancy, the key dates, the seller's link, and the
--                           signature with a frozen copy of what was signed.
--   listing_launch_items  → the checklist rows. who = maxwell's pick from the
--                           dropdown. due = a fixed 'YYYY-MM-DDTHH:MM' or a key
--                           that follows the plan's dates (@by-photo, @photo,
--                           @photo+24, @photo+48, @by-final, @final, @by-live,
--                           @live, @offers), so moving the shoot moves them.
--   launch_plan_templates → Maxwell's own default checklist, one row per agent.
--
-- THE SELLER'S LINK can only do three things, all through the functions below:
-- read the plan, tick an item assigned to the seller, and sign once. It cannot
-- add, delete, retitle or reassign anything, or tick Maxwell's items. Item notes
-- are never returned to it.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.listing_launch_plans (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references public.agents(id) on delete cascade,
  walkthrough_id     uuid not null unique references public.walkthroughs(id) on delete cascade,
  client_id          uuid references public.clients(id) on delete set null,
  units              jsonb not null default '[]'::jsonb,   -- [{ "name": "Top unit", "occ": "vacant|tenant|owner" }]
  dates              jsonb not null default '{}'::jsonb,   -- { photo, final, live: 'YYYY-MM-DDTHH:MM', offers: 'YYYY-MM-DD' }
  status             text not null default 'draft',        -- draft → sent → signed
  seller_token       uuid unique default gen_random_uuid(),
  sent_at            timestamptz,
  signed_at          timestamptz,
  signed_name        text,
  signed_snapshot    jsonb,                                -- the exact list and dates the seller signed
  signed_user_agent  text,
  media_approved_at  timestamptz,
  copy_filed_at      timestamptz,                          -- signed PDF saved to Documents + email queued
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists listing_launch_plans_agent_idx on public.listing_launch_plans (agent_id);
create index if not exists listing_launch_plans_token_idx on public.listing_launch_plans (seller_token);

create table if not exists public.listing_launch_items (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.listing_launch_plans(id) on delete cascade,
  agent_id       uuid not null references public.agents(id) on delete cascade,
  item_key       text,                                     -- template key; null for hand-added items
  unit           text not null default 'Whole property',
  title          text not null,
  who            text not null default 'agent',            -- agent / seller / tenant / cleaner / painter / ...
  due            text,
  status         text not null default 'open',             -- open / done / skip
  note           text,                                     -- PRIVATE. Never returned to the seller's link.
  done_at        timestamptz,
  done_by        text,                                     -- 'agent' | 'seller'
  prep_visit_id  uuid references public.meetings(id) on delete set null,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists listing_launch_items_plan_idx on public.listing_launch_items (plan_id, sort_order);
create index if not exists listing_launch_items_visit_idx on public.listing_launch_items (prep_visit_id);

create table if not exists public.launch_plan_templates (
  agent_id    uuid primary key references public.agents(id) on delete cascade,
  items       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.listing_launch_plans  enable row level security;
alter table public.listing_launch_items  enable row level security;
alter table public.launch_plan_templates enable row level security;

drop policy if exists "Agents manage own launch plans" on public.listing_launch_plans;
create policy "Agents manage own launch plans"
  on public.listing_launch_plans for all
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());

drop policy if exists "Agents manage own launch items" on public.listing_launch_items;
create policy "Agents manage own launch items"
  on public.listing_launch_items for all
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());

drop policy if exists "Agents manage own launch template" on public.launch_plan_templates;
create policy "Agents manage own launch template"
  on public.launch_plan_templates for all
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- The seller's link. Every function returns jsonb, so there is no RETURNS
-- TABLE column type to drift out of step with varchar columns.
-- ══════════════════════════════════════════════════════════════════════════

-- Which seller items must be done before signing: undated, due by or on the
-- photo shoot, or a fixed date no later than the shoot. js/launchplan.js and
-- launch-plan.html apply the same rule.
create or replace function public._launch_item_needed_to_sign(p_due text, p_photo text)
returns boolean
language sql
immutable
as $$
  select case
    when p_due is null or p_due = '' then true
    when p_due in ('@by-photo', '@photo') then true
    when left(p_due, 1) = '@' then false
    when p_photo is null or p_photo = '' then true
    else p_due <= p_photo
  end;
$$;

create or replace function public.launch_plan_for_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  public.listing_launch_plans%rowtype;
  v_out   jsonb;
begin
  if p_token is null then return null; end if;

  select * into v_plan from public.listing_launch_plans
   where seller_token = p_token and sent_at is not null
   limit 1;
  if v_plan.id is null then return null; end if;

  select jsonb_build_object(
    'plan', jsonb_build_object(
      'property_address', w.property_address::text,
      'seller_name',      c.full_name::text,
      'agent_name',       a.name::text,
      'agent_email',      a.email::text,
      'units',            v_plan.units,
      'dates',            v_plan.dates,
      'status',           v_plan.status,
      'signed_at',        v_plan.signed_at,
      'signed_name',      v_plan.signed_name,
      'media_approved_at', v_plan.media_approved_at
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'item_key', i.item_key, 'unit', i.unit, 'title', i.title,
               'who', i.who, 'due', i.due, 'status', i.status)
             order by i.sort_order, i.created_at)
        from public.listing_launch_items i
       where i.plan_id = v_plan.id and i.status <> 'skip'
    ), '[]'::jsonb)
  ) into v_out
  from public.walkthroughs w
  join public.agents a on a.id = v_plan.agent_id
  left join public.clients c on c.id = v_plan.client_id
  where w.id = v_plan.walkthrough_id;

  return v_out;
end;
$$;

create or replace function public.launch_plan_tick(p_token uuid, p_item uuid, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan uuid;
  v_n    integer;
begin
  if p_token is null or p_item is null then return jsonb_build_object('ok', false); end if;

  select id into v_plan from public.listing_launch_plans
   where seller_token = p_token and sent_at is not null and status in ('sent', 'signed')
   limit 1;
  if v_plan is null then return jsonb_build_object('ok', false); end if;

  update public.listing_launch_items
     set status     = case when p_done then 'done' else 'open' end,
         done_at    = case when p_done then now() else null end,
         done_by    = case when p_done then 'seller' else null end,
         updated_at = now()
   where id = p_item and plan_id = v_plan and who = 'seller' and status <> 'skip';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', v_n = 1);
end;
$$;

create or replace function public.launch_plan_sign(p_token uuid, p_name text, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  public.listing_launch_plans%rowtype;
  v_name  text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_open  integer;
  v_snap  jsonb;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if array_length(regexp_split_to_array(v_name, '\s+'), 1) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;

  select * into v_plan from public.listing_launch_plans
   where seller_token = p_token and sent_at is not null and status = 'sent'
   limit 1
   for update;
  if v_plan.id is null then return jsonb_build_object('ok', false, 'reason', 'link'); end if;

  select count(*) into v_open
    from public.listing_launch_items i
   where i.plan_id = v_plan.id and i.who = 'seller' and i.status = 'open'
     and public._launch_item_needed_to_sign(i.due, v_plan.dates->>'photo');
  if v_open > 0 then return jsonb_build_object('ok', false, 'reason', 'open', 'open', v_open); end if;

  select jsonb_build_object(
    'dates', v_plan.dates,
    'units', v_plan.units,
    'items', coalesce(jsonb_agg(jsonb_build_object(
               'unit', i.unit, 'title', i.title, 'who', i.who, 'due', i.due, 'status', i.status)
             order by i.sort_order, i.created_at), '[]'::jsonb))
    into v_snap
    from public.listing_launch_items i
   where i.plan_id = v_plan.id and i.status <> 'skip';

  update public.listing_launch_plans
     set status            = 'signed',
         signed_at         = now(),
         signed_name       = v_name,
         signed_snapshot   = v_snap,
         signed_user_agent = left(coalesce(p_user_agent, ''), 300),
         copy_filed_at     = null,
         updated_at        = now()
   where id = v_plan.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Opens only once Maxwell has ticked "Photos sent to seller to review".
create or replace function public.launch_plan_approve_media(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan uuid;
begin
  if p_token is null then return jsonb_build_object('ok', false); end if;

  select p.id into v_plan from public.listing_launch_plans p
   where p.seller_token = p_token and p.status = 'signed' and p.media_approved_at is null
     and exists (select 1 from public.listing_launch_items i
                  where i.plan_id = p.id and i.item_key = 'photoreview' and i.status = 'done')
   limit 1;
  if v_plan is null then return jsonb_build_object('ok', false); end if;

  update public.listing_launch_plans
     set media_approved_at = now(), updated_at = now()
   where id = v_plan;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public._launch_item_needed_to_sign(text, text)        from public;
revoke execute on function public.launch_plan_for_token(uuid)                    from public;
revoke execute on function public.launch_plan_tick(uuid, uuid, boolean)          from public;
revoke execute on function public.launch_plan_sign(uuid, text, text)             from public;
revoke execute on function public.launch_plan_approve_media(uuid)                from public;
grant  execute on function public._launch_item_needed_to_sign(text, text)        to anon, authenticated;
grant  execute on function public.launch_plan_for_token(uuid)                    to anon, authenticated;
grant  execute on function public.launch_plan_tick(uuid, uuid, boolean)          to anon, authenticated;
grant  execute on function public.launch_plan_sign(uuid, text, text)             to anon, authenticated;
grant  execute on function public.launch_plan_approve_media(uuid)                to anon, authenticated;
