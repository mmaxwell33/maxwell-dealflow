-- ─────────────────────────────────────────────────────────────────────────────
-- 080_broker_own_clients_agent_tag.sql
-- Maxwell (2026-07-22): the broker works with clients referred by DIFFERENT
-- agents, and wants to manage them all in one place while knowing who each
-- belongs to. This re-enables the broker's own-client feature (frozen in
-- Session 10) with three additions:
--   • referred_by_agent_name / referred_by_agent_email — who sent the client
--   • handed_to_email — the agent the broker hands the finished client back to
-- Isolation is UNCHANGED: broker_clients stays broker_id = auth.uid() only.
-- Maxwell has NO access to these rows — they are the broker's own book, and the
-- broker is the controller responsible for his own clients' consent.
--
-- NOTE: broker_clients (migration 072) was frozen and never applied to the live
-- database, so this migration is self-contained — it CREATEs the table (and its
-- RLS + move function) IF NOT EXISTS, then adds the new columns. Safe to re-run.
-- Apply in the Supabase SQL Editor after 079.
-- ─────────────────────────────────────────────────────────────────────────────

-- The broker's own private clients (from other Realtors / his own book).
CREATE TABLE IF NOT EXISTS public.broker_clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id         UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name              TEXT,
  email             TEXT,
  phone             TEXT,
  status            TEXT NOT NULL DEFAULT 'active',   -- active | moved_to_agent | handed_to_agent
  max_amount        NUMERIC,
  prequal_status    TEXT,                             -- pre_approved | conditional | soft_prequal | declined
  rate_hold         DATE,
  notes             TEXT,
  moved_to_agent_id UUID,
  referred_by_agent_name  TEXT,
  referred_by_agent_email TEXT,
  handed_to_email         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bc_broker_idx ON public.broker_clients (broker_id);
ALTER TABLE public.broker_clients ENABLE ROW LEVEL SECURITY;

-- ONLY the broker sees/edits their own private clients. Maxwell has NO access.
DROP POLICY IF EXISTS "bc broker own" ON public.broker_clients;
CREATE POLICY "bc broker own"
  ON public.broker_clients FOR ALL
  TO authenticated
  USING (broker_id = auth.uid())
  WITH CHECK (broker_id = auth.uid());

-- In case the table already existed from an earlier partial apply:
ALTER TABLE public.broker_clients
  ADD COLUMN IF NOT EXISTS referred_by_agent_name  TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_agent_email TEXT,
  ADD COLUMN IF NOT EXISTS handed_to_email         TEXT;

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS broker_account_id UUID;

-- "Move to Maxwell": the broker pushes one of his OWN clients to his Realtor.
CREATE OR REPLACE FUNCTION public.broker_move_client_to_agent(p_client_id UUID, p_agent_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bc public.broker_clients%ROWTYPE; v_new UUID;
BEGIN
  SELECT * INTO v_bc FROM public.broker_clients WHERE id = p_client_id AND broker_id = auth.uid();
  IF v_bc.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  -- The broker may only move clients to the Realtor who set them up.
  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = auth.uid() AND created_by = p_agent_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_linked');
  END IF;
  INSERT INTO public.broker_referral_requests
    (agent_id, broker_id, client_name, client_email, client_phone, token, status, source,
     snapshot_max_amount, snapshot_status, snapshot_rate_hold, snapshot_updated_at, ready_at)
  VALUES (p_agent_id, auth.uid(), v_bc.name, v_bc.email, v_bc.phone, gen_random_uuid()::text,
     'ready_for_agent', 'broker_transfer', v_bc.max_amount, v_bc.prequal_status, v_bc.rate_hold, now(), now())
  RETURNING id INTO v_new;
  UPDATE public.broker_clients SET status = 'moved_to_agent', moved_to_agent_id = p_agent_id, updated_at = now()
   WHERE id = p_client_id;
  RETURN jsonb_build_object('ok', true, 'referral_id', v_new);
END; $$;
GRANT EXECUTE ON FUNCTION public.broker_move_client_to_agent(UUID, UUID) TO authenticated;
