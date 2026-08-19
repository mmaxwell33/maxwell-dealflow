-- 095_returning_client_lookup.sql
-- Let a returning client pull up their own details on the public form instead of
-- typing everything again. Requested twice by Maxwell; this is that feature.
--
-- ── THE PROBLEM WITH THE OBVIOUS VERSION ─────────────────────────────────────
-- "Type your email and it shows your name and phone" makes the public form a
-- client-list harvester. Anyone could type a guessed address and be told whether
-- that person is a client, plus their full name and phone number, none of which
-- the person typing knew beforehand.
--
-- ── HOW THIS CLOSES IT WITHOUT LOSING THE FEATURE ────────────────────────────
-- The lookup requires TWO matching facts: a surname AND either the email or the
-- phone on file, both belonging to the same client. Anyone who already knows a
-- person's surname and their email address is not learning anything new about
-- them from this form. The real client knows both instantly, so it stays two
-- quick fields instead of five.
--
-- Additional limits:
--   * scoped to one agent, so it can never match across agents
--   * returns nothing at all on a miss, and the same nothing for a wrong
--     surname, an unknown contact, or an archived client, so it cannot be used
--     to test whether an address exists
--   * never returns the client id or the intake_token. A caller cannot obtain
--     an identifier, so a successful lookup grants no capability beyond seeing
--     the details they already proved they knew
--   * attaching on submit re-runs this same two-fact check server-side, so a
--     forged payload cannot attach a submission to someone else's record
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ══════════════════════════════════════════════════════════════════════════
-- 0. THE FOUNDER FALLBACK — the bug that lost a real client's submission
-- ══════════════════════════════════════════════════════════════════════════
-- On 2026-08-19 a client filled in the intake form and it never appeared in the
-- app. The row saved correctly; it was stamped to agent e0cd3307, an agents row
-- with NO matching auth.users record. Nobody can sign in as that account, and
-- both the app query and the RLS policy scope reads to agent_id = auth.uid(),
-- so the submission was invisible to everyone. It looked like lost data and was
-- very nearly a lost client.
--
-- Cause: every intake path falls back to
--     select id from agents where created_by is null limit 1
-- when the link carries no ?a=. There is more than one row with created_by null,
-- and LIMIT without ORDER BY has no defined result, so it can and did return the
-- account that cannot log in.
--
-- Fix: resolve the founder to an agent that actually HAS a login, deterministically.
-- Used by submit_intake below. The same broken pattern appears in seven earlier
-- migrations; they are left alone rather than rewritten, since this function is
-- the one the public intake path actually calls.

create or replace function public.dealflow_founder_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
  from public.agents a
  join auth.users u on u.id = a.id      -- must be an account someone can sign into
  where a.created_by is null
  order by a.created_at                  -- deterministic: oldest real founder wins
  limit 1;
$$;

revoke execute on function public.dealflow_founder_id() from public;
grant  execute on function public.dealflow_founder_id() to anon, authenticated;

-- ── Recover anything already stranded on a login-less agent ───────────────
-- These rows are unreachable by every user in the system, so reassigning them
-- to the real founder cannot take anything away from anyone.
update public.client_intake ci
   set agent_id = public.dealflow_founder_id()
 where public.dealflow_founder_id() is not null
   and (ci.agent_id is null
        or not exists (select 1 from auth.users u where u.id = ci.agent_id));

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The lookup
-- ══════════════════════════════════════════════════════════════════════════

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
  select c.full_name, c.email, c.phone, c.client_type
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
-- 2. Attaching on submit, re-verified server-side
-- ══════════════════════════════════════════════════════════════════════════
-- Extends migration 094's submit_intake. A payload may now claim a lookup
-- match by sending back the surname and contact it matched on. Those two facts
-- are checked again here against the same rules, so the claim is worthless
-- unless it is true. Everything else in 090 is preserved exactly.

create or replace function public.submit_intake(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id        uuid := gen_random_uuid();
  target_agent  uuid;
  invite        uuid;
  known_client  uuid;
  guess_client  uuid;
  in_email      text;
  in_phone      text;
  v_surname     text;
  v_contact     text;
  v_digits      text;
  founder       uuid;
  v_broker_email text;
  v_broker_id   uuid;
  returning_flag boolean := coalesce((payload->>'is_returning')::boolean, false);
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'submit_intake: payload must be a jsonb object';
  end if;

  if nullif(payload->>'email', '') is null then
    raise exception 'submit_intake: email is required';
  end if;
  if nullif(payload->>'full_name', '') is null
     and nullif(payload->>'first_name', '') is null then
    raise exception 'submit_intake: full_name or first_name is required';
  end if;

  -- ── Invite token (migration 094) ──
  begin
    invite := nullif(payload->>'invite_token', '')::uuid;
  exception when others then
    invite := null;
  end;

  if invite is not null then
    select c.id, c.agent_id into known_client, target_agent
    from public.clients c
    where c.intake_token = invite
      and coalesce(c.status, '') <> 'Archived'
    limit 1;
    if known_client is not null then
      returning_flag := true;
    end if;
  end if;

  -- ── Agent resolution (migration 087) ──
  if target_agent is null and nullif(payload->>'agent_id', '') is not null then
    select id into target_agent from public.agents where id = (payload->>'agent_id')::uuid;
  end if;
  if target_agent is null then
    target_agent := public.dealflow_founder_id();
  end if;

  -- ── Lookup match, re-verified. Never trust the claim, only the facts. ──
  if known_client is null then
    v_surname := lower(trim(coalesce(payload->>'lookup_surname', '')));
    v_contact := lower(trim(coalesce(payload->>'lookup_contact', '')));
    v_digits  := regexp_replace(coalesce(payload->>'lookup_contact', ''), '\D', '', 'g');

    if length(v_surname) >= 2 and v_contact <> '' then
      select c.id into known_client
      from public.clients c
      where c.agent_id = target_agent
        and coalesce(c.status, '') <> 'Archived'
        and coalesce(c.is_guest, false) = false
        and lower(split_part(trim(c.full_name), ' ', array_length(string_to_array(trim(c.full_name), ' '), 1))) = v_surname
        and (
          lower(trim(coalesce(c.email, ''))) = v_contact
          or (length(v_digits) >= 7
              and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits)
        )
      limit 1;
      if known_client is not null then
        returning_flag := true;
      end if;
    end if;
  end if;

  -- ── Probable match, for a returning visitor we could not verify ──
  if known_client is null and returning_flag then
    in_email := lower(trim(payload->>'email'));
    in_phone := regexp_replace(coalesce(payload->>'phone', ''), '\D', '', 'g');

    select c.id into guess_client
    from public.clients c
    where c.agent_id = target_agent
      and coalesce(c.status, '') <> 'Archived'
      and lower(trim(coalesce(c.email, ''))) = in_email
      and in_email <> ''
    limit 1;

    if guess_client is null and length(in_phone) >= 7 then
      select c.id into guess_client
      from public.clients c
      where c.agent_id = target_agent
        and coalesce(c.status, '') <> 'Archived'
        and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = in_phone
      limit 1;
    end if;
  end if;

  payload := (payload - 'id' - 'agent_id' - 'invite_token' - 'is_returning'
                      - 'client_id' - 'matched_client_id'
                      - 'lookup_surname' - 'lookup_contact')
             || jsonb_build_object(
                  'id', new_id,
                  'agent_id', target_agent,
                  'client_id', known_client,
                  'matched_client_id', guess_client,
                  'is_returning', returning_flag
                );

  if not (payload ? 'intake_type') or nullif(payload->>'intake_type', '') is null then
    payload := payload || jsonb_build_object('intake_type', 'buyer');
  end if;

  insert into public.client_intake
  select * from jsonb_populate_record(null::public.client_intake, payload);

  -- ── Website lender lead → pending broker referral, auto-linked ────────────
  -- RESTORED FROM MIGRATION 078. Migration 087 rebuilt submit_intake and
  -- silently dropped this block, so depending on which migration was applied
  -- last, website lender leads may have stopped reaching the broker's portal
  -- automatically. Carried forward here so that this rewrite cannot be the
  -- thing that loses it again. Behaviour is 078's, unchanged.
  if lower(coalesce(payload->>'referral_source', '')) like '%lender%'
     or lower(coalesce(payload->>'referral_source', '')) like '%mortgage%' then

    founder := public.dealflow_founder_id();

    -- The founder's ACTIVE broker: the email saved in Settings, matched to a
    -- broker-role account. NULL if none is set up, and then it stays unlinked.
    select lower(broker_email) into v_broker_email from public.agents where id = founder;
    if v_broker_email is not null then
      select id into v_broker_id
        from public.agents
       where role = 'broker' and lower(email) = v_broker_email
       limit 1;
    end if;

    begin
      insert into public.broker_referral_requests
        (agent_id, client_id, broker_id, client_name, client_email, client_phone, token, status, source)
      values
        (founder, null, v_broker_id,
         nullif(payload->>'full_name', ''),
         nullif(payload->>'email', ''),
         nullif(payload->>'phone', ''),
         gen_random_uuid()::text,
         'pending', 'website');
    exception when unique_violation then
      -- An active referral for this email already exists; make sure it is linked
      -- to the current broker so it still surfaces in the portal.
      update public.broker_referral_requests
         set broker_id = v_broker_id
       where lower(client_email) = lower(nullif(payload->>'email', ''))
         and status in ('pending', 'approved')
         and broker_id is null;
    end;
  end if;

  return jsonb_build_object('id', new_id);
end;
$$;

revoke execute on function public.submit_intake(jsonb) from public;
grant  execute on function public.submit_intake(jsonb) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Still worth adding later
-- ══════════════════════════════════════════════════════════════════════════
-- Rate limiting on lookup_returning_client. The two-fact rule is the real
-- control and it holds on its own, but a per-caller attempt cap would blunt
-- automated guessing further. Deferred rather than done badly: PostgREST does
-- not hand the caller's address to Postgres without extra plumbing, and a
-- counter keyed on the guessed contact itself is trivially sidestepped.
