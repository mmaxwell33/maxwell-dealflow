-- Maxwell DealFlow — Migration 040
-- Phase 2.A PR #1 — security/rls-respond-flow
--
-- Closes AUDIT_REPORT.md P0 items #1, #2, and the related pending_offers tightening:
--
--   #1  viewing_responses anon SELECT used USING (true) → entire table world-readable
--       by anyone holding the public anon key. Every token, every client email,
--       every property price was leakable with one curl.
--
--   #2  viewing_responses anon UPDATE had no WITH CHECK, and the scope was just
--       "not expired" — anyone with ANY live token could PATCH ANY non-expired row.
--
--   bonus  viewings anon UPDATE was scoped by "ANY live token exists somewhere" —
--          functionally a public UPDATE on the whole viewings table. respond.html
--          never actually needs to UPDATE viewings, so the policy + grant are
--          dropped entirely.
--
--   bonus  pending_offers anon INSERT was WITH CHECK (true) — spammable inbox.
--          Now bound to a valid token whose viewing_id + agent_id match the
--          row being inserted.
--
-- Approach: the response token now travels in an X-Response-Token request header,
-- and every USING / WITH CHECK clause matches against it via a small SQL helper
-- that reads the header out of PostgREST's request envelope. JS-side enforcement
-- is now redundant — the server enforces every guard.
--
-- Client change (PR #1 same diff): respond.html sets X-Response-Token on every
-- Supabase REST call. No other client touches these tables as anon.

-- ============================================================
-- 1. Helper: pull the X-Response-Token header out of the request
-- ============================================================
-- PostgREST exposes incoming headers via current_setting('request.headers').
-- Header names are lowercased. Wrapped in plpgsql + EXCEPTION so a missing
-- or malformed setting fails closed (NULL = no row matches).
CREATE OR REPLACE FUNCTION public._dealflow_request_token()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  hdrs text;
BEGIN
  hdrs := current_setting('request.headers', true);
  IF hdrs IS NULL OR hdrs = '' THEN
    RETURN NULL;
  END IF;
  RETURN NULLIF((hdrs::json) ->> 'x-response-token', '');
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._dealflow_request_token() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._dealflow_request_token() TO anon, authenticated;

-- ============================================================
-- 2. viewing_responses — token-scoped anon policies
-- ============================================================
-- Drop both the original broken pair AND the new names (idempotent re-runs).
DROP POLICY IF EXISTS "viewing_responses_anon_select"       ON viewing_responses;
DROP POLICY IF EXISTS "viewing_responses_anon_update"       ON viewing_responses;
DROP POLICY IF EXISTS "viewing_responses_anon_select_token" ON viewing_responses;
DROP POLICY IF EXISTS "viewing_responses_anon_update_token" ON viewing_responses;

-- Anon can SELECT only the row whose token matches the request header.
-- Expired rows are still returned so respond.html can render the
-- "request a new link" affordance — possession of the token IS the auth.
CREATE POLICY "viewing_responses_anon_select_token"
  ON viewing_responses
  FOR SELECT
  TO anon
  USING (
    token = public._dealflow_request_token()
  );

-- Anon can UPDATE only that row, only while still live, only once.
-- WITH CHECK locks the token field (no lateral movement to another row's
-- token) and requires responded_at to be set on the post-update state
-- (no half-finished writes that leave the row reusable).
CREATE POLICY "viewing_responses_anon_update_token"
  ON viewing_responses
  FOR UPDATE
  TO anon
  USING (
    token        = public._dealflow_request_token()
    AND expired      = false
    AND expires_at   > now()
    AND responded_at IS NULL
  )
  WITH CHECK (
    token        = public._dealflow_request_token()
    AND responded_at IS NOT NULL
  );

-- ============================================================
-- 3. viewings — drop anon UPDATE entirely
-- ============================================================
-- The original viewings_anon_client_response let any anon caller holding any
-- live token UPDATE any viewing on any column. respond.html doesn't actually
-- write to viewings — it only PATCHes viewing_responses and POSTs to
-- pending_offers. Removing this policy closes the hole; the column grant is
-- revoked as a second layer of defence.
DROP POLICY IF EXISTS "viewings_anon_client_response" ON viewings;
REVOKE UPDATE ON public.viewings FROM anon;

-- ============================================================
-- 4. pending_offers — anon INSERT must be backed by a valid token
-- ============================================================
DROP POLICY IF EXISTS "pending_offers_anon_insert"           ON pending_offers;
DROP POLICY IF EXISTS "pending_offers_anon_insert_via_token" ON pending_offers;

-- An anon caller can INSERT a pending_offers row only when a viewing_response
-- exists whose token matches the request header AND whose viewing_id +
-- agent_id (+ client_id when set) match the row being inserted. Spammers
-- without a token can no longer reach the agent's offer-request surface.
CREATE POLICY "pending_offers_anon_insert_via_token"
  ON pending_offers
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM viewing_responses vr
      WHERE vr.token      = public._dealflow_request_token()
        AND vr.agent_id   = pending_offers.agent_id
        AND vr.viewing_id IS NOT DISTINCT FROM pending_offers.viewing_id
        AND (vr.client_id IS NULL OR vr.client_id = pending_offers.client_id)
    )
  );

-- ============================================================
-- 5. Smoke tests — run these in the Supabase SQL editor after applying
-- ============================================================
-- As anon with no header:
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM viewing_responses;          -- expect 0
--   SELECT count(*) FROM pending_offers;             -- expect 0 (existing agent-own policy filters)
--
-- As anon with a known-good token in the header (use PostgREST request stub
-- or curl with -H "X-Response-Token: <token>"):
--   SELECT id, token FROM viewing_responses;         -- expect 1 row
--   UPDATE viewing_responses SET responded_at=now()
--     WHERE token='<token>';                         -- expect 1 row affected
--
-- As anon with a bogus header value:
--   SELECT count(*) FROM viewing_responses;          -- expect 0
--
-- As an authenticated agent (existing agent-own policies):
--   No behavioural change — every agent-side path goes through db.from(...)
--   with the authenticated session and hits viewing_responses_agent_own /
--   pending_offers_agent_own, which this migration does not touch.
