-- 109: resolve_walkthrough_token read a.full_name, but the agents table's
-- column is "name" (see 022/025). Every call failed with 42703, and
-- walkthrough-review.html shows any error as "This link is no longer active",
-- so every seller link looked expired the moment it was opened.
-- Only change from 101: a.full_name -> a.name.

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
         a.name::text,
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
