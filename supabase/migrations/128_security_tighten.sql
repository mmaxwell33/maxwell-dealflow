-- ─────────────────────────────────────────────────────────────────────────────
-- 128_security_tighten.sql
-- Closes the access gaps found in the 2026-11-27 security check. Safe to run
-- BEFORE the matching code ships: nothing the live app or any portal page uses
-- loses access. (The new-build link rules are closed separately in 129, after
-- build.html has moved to build_token_load.)
--
-- 1. deal_stakeholders: the dashboard-made policy "ds_agent_all" let ANY
--    logged-in account read, change or delete every row (contacts on every
--    deal and the portal tokens that open each deal). Now own deals only.
-- 2. stakeholder_access_log: readable by any logged-in account. Now own only.
-- 3. email_inbox: "Service insert inbox" let anyone, even logged out, add
--    messages to an agent's inbox. The server functions use the service key and
--    the app writes its own rows under "Agents manage own inbox", so neither
--    needs it.
-- 4. stakeholder_create: could be run without logging in, for any deal id, and
--    trusted the agent id it was given. Now: logged in, own deal only.
-- 5. lookup_returning_client: knowing a surname and email returned the phone
--    number too (and the other way round). Now it returns only the detail the
--    person typed, so it never reveals one they did not already know.
-- 6. build_token_load: new. Loads one new-build portal by its exact link, for
--    build.html, so the build tables no longer need to be open to the public.
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/128_security_tighten.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. deal_stakeholders ─────────────────────────────────────────────────────────
-- One row was saved without an agent; give it its deal's agent first.
UPDATE public.deal_stakeholders s
   SET agent_id = p.agent_id
  FROM public.pipeline p
 WHERE p.id = s.pipeline_id AND s.agent_id IS NULL;

DROP POLICY IF EXISTS "ds_agent_all" ON public.deal_stakeholders;
DROP POLICY IF EXISTS "deal_stakeholders_own" ON public.deal_stakeholders;
CREATE POLICY "deal_stakeholders_own" ON public.deal_stakeholders
  FOR ALL TO authenticated
  USING (
    agent_id = auth.uid()
    OR pipeline_id IN (SELECT id FROM public.pipeline WHERE agent_id = auth.uid())
  )
  WITH CHECK (
    agent_id = auth.uid()
    OR pipeline_id IN (SELECT id FROM public.pipeline WHERE agent_id = auth.uid())
  );

-- 2. stakeholder_access_log ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sal_agent_read" ON public.stakeholder_access_log;
DROP POLICY IF EXISTS "stakeholder_access_log_own" ON public.stakeholder_access_log;
CREATE POLICY "stakeholder_access_log_own" ON public.stakeholder_access_log
  FOR SELECT TO authenticated
  USING (stakeholder_id IN (SELECT id FROM public.deal_stakeholders WHERE agent_id = auth.uid()));

-- 3. email_inbox ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service insert inbox" ON public.email_inbox;

-- 4. stakeholder_create ────────────────────────────────────────────────────────
-- Same signature and return shape, so every caller keeps working. The agent is
-- always the logged-in user; p_agent_id is kept only for compatibility.
CREATE OR REPLACE FUNCTION public.stakeholder_create(
  p_pipeline_id uuid, p_client_id uuid, p_agent_id uuid, p_role text,
  p_name text, p_email text, p_phone text, p_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text;
  v_id    uuid;
  v_url   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_signed_in');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pipeline WHERE id = p_pipeline_id AND agent_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_deal');
  END IF;

  v_token := replace(replace(replace(encode(gen_random_bytes(24),'base64'),'+','-'),'/','_'),'=','');

  INSERT INTO deal_stakeholders
    (pipeline_id, client_id, agent_id, role, name, email, phone, token, token_expires, token_sent_at, notes)
  VALUES
    (p_pipeline_id, p_client_id, v_uid, p_role, p_name, p_email, p_phone,
     v_token, now() + interval '90 days', now(), p_notes)
  RETURNING id INTO v_id;

  v_url := 'https://maxwellmidodzi.com/stakeholder.html?t=' || v_token;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'token', v_token, 'portal_url', v_url);
END $function$;

REVOKE ALL ON FUNCTION public.stakeholder_create(uuid, uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stakeholder_create(uuid, uuid, uuid, text, text, text, text, text) TO authenticated;

-- 5. lookup_returning_client ───────────────────────────────────────────────────
-- Same inputs and columns, so intake.html and seller-intake.html keep working.
-- The email comes back only when they typed that email; the phone only when
-- they typed that phone. The other field is left for them to fill in.
CREATE OR REPLACE FUNCTION public.lookup_returning_client(p_agent_id uuid, p_surname text, p_contact text)
RETURNS TABLE(full_name text, email text, phone text, client_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  select id into v_agent from public.agents where id = p_agent_id;
  if v_agent is null then
    v_agent := public.dealflow_founder_id();
  end if;
  if v_agent is null then
    return;
  end if;
  return query
  select c.full_name::text,
         case when lower(trim(coalesce(c.email, ''))) = v_contact then c.email::text end,
         case when length(v_digits) >= 7
               and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits
              then c.phone::text end,
         c.client_type::text
  from public.clients c
  where c.agent_id = v_agent
    and coalesce(c.status, '') <> 'Archived'
    and coalesce(c.is_guest, false) = false
    and lower(split_part(trim(c.full_name), ' ', array_length(string_to_array(trim(c.full_name), ' '), 1))) = v_surname
    and (
      lower(trim(coalesce(c.email, ''))) = v_contact
      or (length(v_digits) >= 7
          and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits)
    )
  limit 1;
end;
$function$;

-- 6. build_token_load ──────────────────────────────────────────────────────────
-- Returns the same shape build.html read from the REST call it replaces:
-- [ { ...build_tokens row, "new_builds": { ...build } } ], or [] for a bad link.
-- The builder's and buyer's own link tokens are left out of the build.
CREATE OR REPLACE FUNCTION public.build_token_load(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(jsonb_agg(
           to_jsonb(t) || jsonb_build_object('new_builds',
             to_jsonb(b) - 'builder_token' - 'builder_token_expires'
                         - 'client_token'  - 'client_token_expires')
         ), '[]'::jsonb)
    FROM public.build_tokens t
    JOIN public.new_builds b ON b.id = t.build_id
   WHERE p_token IS NOT NULL AND length(p_token) >= 16 AND t.token = p_token;
$function$;

REVOKE ALL ON FUNCTION public.build_token_load(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_token_load(text) TO anon, authenticated;
