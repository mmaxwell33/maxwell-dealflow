-- ─────────────────────────────────────────────────────────────────────────────
-- 079_decommission_broker_lane_token.sql
-- Boardroom (2026-07-22): the pre-login "broker lane" (lane.html + token-keyed
-- RPCs from 067/070) was superseded by the real broker login (071) but never
-- decommissioned. CONFIRMED LIVE via a probe call to broker_list_referrals as
-- anon: the database still returns "invalid_token" (200 OK) instead of
-- permission-denied, meaning anon can still call these functions. Anyone
-- holding a broker_lane_token value could read/write that broker's referral
-- data with no login. Apply in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Kill every existing token/hash outright — closes any live bypass immediately,
--    independent of the grant revokes below.
UPDATE public.agents
   SET broker_lane_token = NULL,
       broker_approval_hash = NULL
 WHERE broker_lane_token IS NOT NULL OR broker_approval_hash IS NOT NULL;

-- 2. Revoke EXECUTE on all five token-keyed RPCs. MUST include PUBLIC — Postgres
--    grants EXECUTE to PUBLIC by default on every function, so revoking only
--    anon/authenticated leaves the default PUBLIC grant intact and the function
--    still callable anonymously (confirmed by a live probe). The real broker
--    login (071) does not use these — only the retired lane.html did.
REVOKE EXECUTE ON FUNCTION public.broker_list_referrals(TEXT)                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broker_set_password(TEXT, TEXT)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broker_approve_referral(TEXT, UUID, TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broker_set_snapshot(TEXT, UUID, NUMERIC, TEXT, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broker_handoff_referral(TEXT, UUID)                  FROM PUBLIC, anon, authenticated;

-- Verify after applying — every call below should now fail with a permission
-- error (42501), not a JSON {"ok":false,...} response:
--   select public.broker_list_referrals('anything');
