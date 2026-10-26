-- 114_intake_prefill.sql
-- "Here's what you told me, please check it."
--
-- WHY: a client Maxwell met in person (a coffee chat) has already told him about
-- the home they are selling and what they want to buy, but has never filled in
-- the intake form. Sending them the blank form makes them type it all again.
-- Maxwell now records what they told him on the client, and their personal
-- invite link (migration 094) opens the intake forms already filled in with it,
-- so they only confirm, correct or add.
--
--   clients.intake_prefill   jsonb  { sell: {...}, buy: {...}, updated_at }
--                            What Maxwell heard. Never shown to anyone without
--                            the client's own invite token.
--
-- get_intake_prefill(token) is a separate function rather than a change to
-- resolve_intake_invite, so the existing link keeps working exactly as before.
-- Same trust model: the token is the only key, and a bad, unknown or archived
-- token returns the same NULL so it cannot be used to probe.
--
-- Additive only. Safe to re-run.

alter table public.clients
  add column if not exists intake_prefill jsonb;

create or replace function public.get_intake_prefill(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if p_token is null then
    return null;
  end if;

  select c.intake_prefill into result
  from public.clients c
  where c.intake_token = p_token
    and coalesce(c.status, '') <> 'Archived'
  limit 1;

  return result;
end;
$$;

revoke execute on function public.get_intake_prefill(uuid) from public;
grant  execute on function public.get_intake_prefill(uuid) to anon, authenticated;
