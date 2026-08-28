-- 100_fix_lookup_return_types.sql
-- Fixes lookup_returning_client, which has been failing on every call since 095.
--
-- ── THE BUG ──────────────────────────────────────────────────────────────────
-- The function declares  returns table (full_name text, email text, ...)
-- but clients.full_name is character varying(255). plpgsql checks the RETURN
-- QUERY row type against the declared one strictly, and varchar is not text, so
-- every call aborted with:
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type character varying(255) does not match expected type
--           text in column 1.
--
-- ── WHY IT LOOKED LIKE A DATA PROBLEM ────────────────────────────────────────
-- intake.html folded the rpc error into the same "I couldn't match that"
-- message it shows for a genuine miss, so a returning client with perfectly
-- valid details was told to check their spelling. The client-side half of this
-- is fixed separately; this migration fixes the function.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────────
-- Cast every returned column to text. All four are cast, not just full_name:
-- the error names only the first mismatched column, and any of the others could
-- be varchar too. Casting a column that is already text is a no-op, so this is
-- correct either way and does not depend on the current column types.
--
-- Nothing else changes. The two-fact matching rule, the agent scoping, the
-- archived/guest exclusions, and the deliberate return-nothing-on-a-miss
-- behaviour from 095 are all preserved exactly as written.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

create or replace function public.lookup_returning_client(
  p_agent_id uuid,
  p_surname  text,
  p_contact  text
)
returns table (full_name text, email text, phone text, client_type text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent   uuid;
  v_surname text := lower(trim(coalesce(p_surname, '')));
  v_contact text := lower(trim(coalesce(p_contact, '')));
  v_digits  text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
begin
  -- Both facts are mandatory. A surname on its own, or a contact on its own,
  -- returns nothing: that single-fact case is exactly the harvesting risk.
  if length(v_surname) < 2 or v_contact = '' then
    return;
  end if;

  -- Resolve the agent the same way submit_intake does, so a missing or unknown
  -- id falls back to the founder rather than searching every agent's clients.
  select id into v_agent from public.agents where id = p_agent_id;
  if v_agent is null then
    v_agent := public.dealflow_founder_id();
  end if;
  if v_agent is null then
    return;
  end if;

  return query
  select c.full_name::text, c.email::text, c.phone::text, c.client_type::text
  from public.clients c
  where c.agent_id = v_agent
    and coalesce(c.status, '') <> 'Archived'
    and coalesce(c.is_guest, false) = false
    -- Surname: last word of the stored full name, so "Kwame Boateng" matches
    -- a typed "boateng" without matching a typed "kwame".
    and lower(split_part(trim(c.full_name), ' ', array_length(string_to_array(trim(c.full_name), ' '), 1))) = v_surname
    and (
      lower(trim(coalesce(c.email, ''))) = v_contact
      or (length(v_digits) >= 7
          and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits)
    )
  limit 1;
end;
$$;

revoke execute on function public.lookup_returning_client(uuid, text, text) from public;
grant  execute on function public.lookup_returning_client(uuid, text, text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- The same defect in migration 094
-- ══════════════════════════════════════════════════════════════════════════
-- resolve_intake_invite reads the same clients columns into the same text
-- return type, so it has been failing on every call for the same reason. It
-- backs the invite-token path (intake.html calls it when a link carries ?t=),
-- where the failure is even quieter: the page simply falls through to the
-- blank form, so an invited client just retypes everything and nobody sees an
-- error. Fixed here rather than in its own migration because it is one bug
-- with two instances, and splitting them risks only half being applied.
--
-- Casts only. The token check, the archived exclusion, and the row selected
-- are exactly as 094 wrote them.

create or replace function public.resolve_intake_invite(p_token uuid)
returns table (client_id uuid, agent_id uuid, full_name text, email text, phone text, client_type text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null then
    return;
  end if;

  return query
  select c.id, c.agent_id, c.full_name::text, c.email::text, c.phone::text, c.client_type::text
  from public.clients c
  where c.intake_token = p_token
    and coalesce(c.status, '') <> 'Archived'
  limit 1;
end;
$$;

revoke execute on function public.resolve_intake_invite(uuid) from public;
grant  execute on function public.resolve_intake_invite(uuid) to anon, authenticated;
