-- 094_returning_client_intake.sql
-- RETURNING CLIENTS: let a past client submit a new enquiry that attaches to the
-- record they already have, instead of creating a second copy of the person.
--
-- The problem today: a client who bought with Maxwell last year and now wants to
-- sell fills in the same public intake form. It lands in client_intake with no
-- link to their existing clients row. When Maxwell clicks "Add as Client",
-- js/extras.js finds the duplicate email, shows "already in your clients list",
-- marks the intake Added, and stops. Everything the client just said about the
-- home they want to sell is discarded.
--
-- WHAT THIS DELIBERATELY DOES NOT DO, and why:
-- Maxwell asked for the public form to look a client up from a typed name, email
-- or phone and display their details back. That would make the form a client-list
-- harvester: anyone could type a guessed email and be told whether that person is
-- a client, plus their full name and phone number. That is a disclosure of
-- personal information to an anonymous party. So identity is proved by holding a
-- token Maxwell sent, exactly like respond.html and the stakeholder portal. The
-- form never reveals anything to someone who merely typed an address.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Link an intake submission to an existing client
-- ══════════════════════════════════════════════════════════════════════════

alter table public.client_intake
  -- Set when the submission arrived through a personal invite link, or when
  -- Maxwell confirms a match in Form Responses. This is the actual fix: the
  -- enquiry now belongs to a person.
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  -- The visitor told us they have worked with this agent before. Their claim,
  -- not a verified fact, which is why it is separate from client_id.
  add column if not exists is_returning boolean not null default false,
  -- A probable match computed server-side on submit. NEVER returned to the
  -- caller. Only Maxwell sees it, and only he decides whether it is right.
  add column if not exists matched_client_id uuid references public.clients(id) on delete set null;

create index if not exists client_intake_client_idx on public.client_intake (client_id);
create index if not exists client_intake_matched_idx on public.client_intake (matched_client_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. The personal invite token
-- ══════════════════════════════════════════════════════════════════════════
-- One stable token per client rather than one per invite. A per-invite token
-- would expire and silently break the link in an email the client kept, which
-- is the failure this feature exists to avoid. Holding it proves only that
-- Maxwell sent you the link, which is exactly the claim being made.

alter table public.clients
  add column if not exists intake_token uuid not null default gen_random_uuid();

create unique index if not exists clients_intake_token_idx on public.clients (intake_token);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. resolve_intake_invite — the ONLY way details are ever revealed
-- ══════════════════════════════════════════════════════════════════════════
-- Takes a token, returns that one client's own contact details so the form can
-- greet them and pre-fill. Returns nothing at all for a bad token, and returns
-- the same nothing whether the token is malformed, unknown or belongs to an
-- archived client, so it cannot be used to probe for valid tokens.

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
  select c.id, c.agent_id, c.full_name, c.email, c.phone, c.client_type
  from public.clients c
  where c.intake_token = p_token
    and coalesce(c.status, '') <> 'Archived'
  limit 1;
end;
$$;

revoke execute on function public.resolve_intake_invite(uuid) from public;
grant  execute on function public.resolve_intake_invite(uuid) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. submit_intake — accepts an invite token, and matches on the generic path
-- ══════════════════════════════════════════════════════════════════════════
-- Rebuilt from migration 087, preserving its agent resolution exactly. Two
-- additions: an invite token attaches the submission to a known client, and a
-- self-declared returning visitor gets a server-side match computed for
-- Maxwell to confirm. The match is stored, never returned.

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

  -- ── Invite token (unchanged trust model: verify, never take on faith) ──
  begin
    invite := nullif(payload->>'invite_token', '')::uuid;
  exception when others then
    invite := null;                    -- a malformed token is simply no token
  end;

  if invite is not null then
    select c.id, c.agent_id into known_client, target_agent
    from public.clients c
    where c.intake_token = invite
      and coalesce(c.status, '') <> 'Archived'
    limit 1;
    if known_client is not null then
      returning_flag := true;          -- holding the token proves it
    end if;
  end if;

  -- ── Agent resolution, exactly as migration 087 established ──
  if target_agent is null and nullif(payload->>'agent_id', '') is not null then
    select id into target_agent from public.agents where id = (payload->>'agent_id')::uuid;
  end if;
  if target_agent is null then
    target_agent := public.dealflow_founder_id();
  end if;

  -- ── Probable match for the generic path ──
  -- Only when they said they are returning and we have no token. Email first,
  -- then phone reduced to digits so formatting differences do not miss.
  -- Scoped to the receiving agent: never matches across agents.
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

  payload := (payload - 'id' - 'agent_id' - 'invite_token' - 'is_returning' - 'client_id' - 'matched_client_id')
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

  -- Deliberately returns only the new id. Never the matched client, never the
  -- known client: the submitter learns nothing about who is on file.
  return jsonb_build_object('id', new_id);
end;
$$;

revoke execute on function public.submit_intake(jsonb) from public;
grant  execute on function public.submit_intake(jsonb) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Notes
-- ══════════════════════════════════════════════════════════════════════════
-- Deals: a returning client keeps ONE clients row and gains a SECOND deal. The
-- finished purchase keeps its own pipeline row, dates and commission; the new
-- sale starts its own. Nothing about a closed transaction is rewritten.
--
-- clients.client_type moves to 'both' when a buyer returns to sell (or the
-- reverse). That is a property of the person, not of either deal.
