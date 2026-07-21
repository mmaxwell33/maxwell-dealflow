-- ─────────────────────────────────────────────────────────────────────────────
-- 067_broker_financing_lane.sql
-- Financing Lane v1 (Boardroom Session 09). Turns broker_referral_requests into
-- a token-based lane the mortgage broker (Mr. Asare) can VIEW, APPROVE, and add a
-- 3-field financing snapshot to — WITHOUT a login. No new tenant/auth surface:
-- possession of the lane token IS the auth, enforced server-side, consistent with
-- migrations 052 (broker referral) and 040 (viewing responses).
--
-- Security: every SECURITY DEFINER function pins `search_path = ''` and fully
-- qualifies object names (guards against search-path hijacking — Supabase best
-- practice). Approvals are idempotent (compare-and-swap on status='pending' +
-- a partial unique index), so two approvers can never double-fire.
--
-- db push is broken on this project — paste this whole file into the Supabase
-- SQL Editor and run it. A DOWN script is at the bottom (commented).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Snapshot + approval-tracking columns on the referral row ──────────────
ALTER TABLE public.broker_referral_requests
  ADD COLUMN IF NOT EXISTS client_phone         TEXT,
  ADD COLUMN IF NOT EXISTS source               TEXT,          -- 'website' | 'manual' | 'soft_offer'
  ADD COLUMN IF NOT EXISTS approved_by          TEXT,          -- 'maxwell' | 'broker'
  ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snapshot_max_amount  NUMERIC,
  ADD COLUMN IF NOT EXISTS snapshot_status      TEXT,          -- pre_approved | conditional | soft_prequal | declined
  ADD COLUMN IF NOT EXISTS snapshot_rate_hold   DATE,
  ADD COLUMN IF NOT EXISTS snapshot_updated_at  TIMESTAMPTZ;

-- ── 2. Idempotency guard: at most ONE active referral per client email ───────
--    Scoped to the new dual-approval statuses so it never interferes with the
--    existing soft-offer flow ('offered'/'requested'/'sent').
CREATE UNIQUE INDEX IF NOT EXISTS brr_active_email_uniq
  ON public.broker_referral_requests (lower(client_email))
  WHERE status IN ('pending','approved') AND client_email IS NOT NULL;

-- ── 3. Broker lane secrets on the agent row ──────────────────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS broker_lane_token    TEXT UNIQUE,   -- Asare's durable private-link secret
  ADD COLUMN IF NOT EXISTS broker_approval_hash TEXT;          -- SHA-256 of his approval password

-- ── 4. Token-keyed RPCs (SECURITY DEFINER, pinned search_path) ───────────────

-- Resolve a lane token → agent_id (NULL if unknown). Internal helper.
CREATE OR REPLACE FUNCTION public._broker_agent_for_token(p_token TEXT)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT id FROM public.agents
   WHERE broker_lane_token = p_token AND p_token IS NOT NULL AND length(p_token) >= 16
   LIMIT 1;
$$;

-- List this broker's referrals — only broker-safe fields, only active rows.
CREATE OR REPLACE FUNCTION public.broker_list_referrals(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE AS $$
DECLARE v_agent UUID; v_has_pass BOOLEAN;
BEGIN
  v_agent := public._broker_agent_for_token(p_token);
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  SELECT (broker_approval_hash IS NOT NULL) INTO v_has_pass FROM public.agents WHERE id = v_agent;
  RETURN jsonb_build_object(
    'ok', true,
    'has_password', COALESCE(v_has_pass, false),
    'referrals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.client_name, 'email', r.client_email, 'phone', r.client_phone,
        'status', r.status, 'approved_by', r.approved_by, 'approved_at', r.approved_at,
        'source', r.source, 'created_at', r.created_at,
        'snapshot', jsonb_build_object('max_amount', r.snapshot_max_amount,
          'status', r.snapshot_status, 'rate_hold', r.snapshot_rate_hold)
      ) ORDER BY r.created_at DESC)
      FROM public.broker_referral_requests r
      WHERE r.agent_id = v_agent
        AND r.status IN ('pending','approved','sent')
        AND r.expires_at > now()
    ), '[]'::jsonb)
  );
END;
$$;

-- First-visit: set the broker's approval password. Only settable ONCE via the
-- token (a token holder cannot reset an existing password — Maxwell re-issues
-- the lane token from his side to reset).
CREATE OR REPLACE FUNCTION public.broker_set_password(p_token TEXT, p_hash TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_agent UUID; v_won UUID;
BEGIN
  v_agent := public._broker_agent_for_token(p_token);
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  IF p_hash IS NULL OR length(p_hash) <> 64 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_hash'); END IF;
  UPDATE public.agents SET broker_approval_hash = p_hash
   WHERE id = v_agent AND broker_approval_hash IS NULL
   RETURNING id INTO v_won;
  IF v_won IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'already_set'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Broker approves a referral: compare-and-swap on status='pending' so exactly
-- one approval wins. Records approved_by='broker'. Deliberately sends NOTHING in
-- Maxwell's name — the broker then reaches out to the client himself.
CREATE OR REPLACE FUNCTION public.broker_approve_referral(p_token TEXT, p_referral_id UUID, p_hash TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_agent UUID; v_stored TEXT; v_won UUID;
BEGIN
  v_agent := public._broker_agent_for_token(p_token);
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  SELECT broker_approval_hash INTO v_stored FROM public.agents WHERE id = v_agent;
  IF v_stored IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_password_set'); END IF;
  IF p_hash IS DISTINCT FROM v_stored THEN RETURN jsonb_build_object('ok', false, 'error', 'wrong_password'); END IF;
  UPDATE public.broker_referral_requests
     SET status = 'approved', approved_by = 'broker', approved_at = now()
   WHERE id = p_referral_id AND agent_id = v_agent AND status = 'pending'
   RETURNING id INTO v_won;
  IF v_won IS NULL THEN RETURN jsonb_build_object('ok', true, 'already_handled', true); END IF;
  RETURN jsonb_build_object('ok', true, 'already_handled', false);
END;
$$;

-- Broker writes the 3-field financing snapshot (strict column allowlist — this
-- function can touch ONLY the snapshot columns, never clients or anything else).
CREATE OR REPLACE FUNCTION public.broker_set_snapshot(p_token TEXT, p_referral_id UUID,
  p_max NUMERIC, p_status TEXT, p_rate DATE)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_agent UUID; v_won UUID;
BEGIN
  v_agent := public._broker_agent_for_token(p_token);
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pre_approved','conditional','soft_prequal','declined')
     THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_status'); END IF;
  UPDATE public.broker_referral_requests
     SET snapshot_max_amount = p_max, snapshot_status = p_status,
         snapshot_rate_hold = p_rate, snapshot_updated_at = now()
   WHERE id = p_referral_id AND agent_id = v_agent
   RETURNING id INTO v_won;
  IF v_won IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 5. Grants — the lane page is anon (no login); helper stays internal ──────
GRANT EXECUTE ON FUNCTION public.broker_list_referrals(TEXT)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broker_set_password(TEXT, TEXT)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broker_approve_referral(TEXT, UUID, TEXT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broker_set_snapshot(TEXT, UUID, NUMERIC, TEXT, DATE) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._broker_agent_for_token(TEXT) FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual rollback — paste if you need to undo):
-- DROP FUNCTION IF EXISTS public.broker_set_snapshot(TEXT,UUID,NUMERIC,TEXT,DATE);
-- DROP FUNCTION IF EXISTS public.broker_approve_referral(TEXT,UUID,TEXT);
-- DROP FUNCTION IF EXISTS public.broker_set_password(TEXT,TEXT);
-- DROP FUNCTION IF EXISTS public.broker_list_referrals(TEXT);
-- DROP FUNCTION IF EXISTS public._broker_agent_for_token(TEXT);
-- DROP INDEX IF EXISTS public.brr_active_email_uniq;
-- ALTER TABLE public.agents DROP COLUMN IF EXISTS broker_lane_token, DROP COLUMN IF EXISTS broker_approval_hash;
-- ALTER TABLE public.broker_referral_requests
--   DROP COLUMN IF EXISTS client_phone, DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS approved_by,
--   DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS snapshot_max_amount,
--   DROP COLUMN IF EXISTS snapshot_status, DROP COLUMN IF EXISTS snapshot_rate_hold, DROP COLUMN IF EXISTS snapshot_updated_at;
-- ─────────────────────────────────────────────────────────────────────────────
