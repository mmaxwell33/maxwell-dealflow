-- 062_client_reviews_seal.sql
-- SECURITY FIX (confirmed 2026-07-15): the public anon key could read the
-- entire client_reviews table with no token — 6 rows returned — exposing
-- client names + private mid-deal feedback. This seals the table: anon loses
-- direct access and the public review page goes through SECURITY DEFINER RPCs
-- (same proven pattern as migration 043 submit_intake). Also adds the
-- publish/consent columns for the later website-testimonials feature.
-- Apply via the Supabase SQL Editor (db push is out of sync on this project).

-- 1) Publish + consent columns for the later "feature on website" flow (harmless now)
alter table public.client_reviews
  add column if not exists published          boolean not null default false,
  add column if not exists published_at       timestamptz,
  add column if not exists display_name       text,
  add column if not exists consent_to_publish boolean not null default false,
  add column if not exists consent_at         timestamptz,
  add column if not exists consent_version    text,
  add column if not exists consent_text       text;

-- 2) Read RPC — the review page looks up its row by token. Returns ONLY the
--    four things the page needs; never email, address, client_id, or other rows.
create or replace function public.get_review_by_token(p_token text)
returns jsonb
language sql security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id',          r.id,
    'status',      r.status,
    'review_type', r.review_type,
    'first_name',  split_part(coalesce(c.full_name, ''), ' ', 1)
  )
  from public.client_reviews r
  left join public.clients c on c.id = r.client_id
  where r.token = p_token;
$$;

-- 3) Submit RPC — client submits their answers. Server-side guards: rejects an
--    unknown token and refuses to overwrite an already-Submitted review.
--    Whitelists only the answer columns; the payload can NEVER set published,
--    consent_*, client_id, review_type, or token.
create or replace function public.submit_review(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.client_reviews;
begin
  select * into r from public.client_reviews where token = p_token;
  if not found then raise exception 'invalid token'; end if;
  if r.status = 'Submitted' then raise exception 'already submitted'; end if;

  -- merge only whitelisted answer fields onto the existing row, coerced back to
  -- the real column types (jsonb_populate_record ignores any unknown key)
  r := jsonb_populate_record(r, to_jsonb(r) || jsonb_build_object(
    'communication',      p_payload->'communication',
    'knowledge',          p_payload->'knowledge',
    'negotiation',        p_payload->'negotiation',
    'would_refer',        p_payload->'would_refer',
    'overall_stars',      p_payload->'overall_stars',
    'comments',           p_payload->'comments',
    'homes_match',        p_payload->'homes_match',
    'next_steps_clarity', p_payload->'next_steps_clarity',
    'feedback_improve',   p_payload->'feedback_improve'
  ));

  update public.client_reviews set
    communication = r.communication, knowledge = r.knowledge,
    negotiation = r.negotiation, would_refer = r.would_refer,
    overall_stars = r.overall_stars, comments = r.comments,
    homes_match = r.homes_match, next_steps_clarity = r.next_steps_clarity,
    feedback_improve = r.feedback_improve,
    status = 'Submitted', submitted_at = now()
  where token = p_token;

  return jsonb_build_object('ok', true);
end;
$$;

-- 4) SEAL — remove anon's direct table access (stops the leak). The CRM uses
--    the authenticated role, which we keep fully intact.
revoke all on public.client_reviews from anon;
grant  all on public.client_reviews to authenticated;

-- 5) Expose ONLY the two RPCs to anon.
revoke execute on function public.get_review_by_token(text)      from public;
revoke execute on function public.submit_review(text, jsonb)     from public;
grant  execute on function public.get_review_by_token(text)      to anon, authenticated;
grant  execute on function public.submit_review(text, jsonb)     to anon, authenticated;
