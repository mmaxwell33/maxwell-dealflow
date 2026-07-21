-- ─────────────────────────────────────────────────────────────────────────────
-- 072_broker_own_clients.sql — Financing Lane Stage 2.
-- Asare's OWN private clients (not from Maxwell) + client transfers both ways.
--
-- Isolation: broker_clients is visible ONLY to the broker who owns it
-- (broker_id = auth.uid()). Maxwell (a different uid) has NO access — his data
-- and the broker's private book never cross except through an explicit transfer.
--
-- Apply in the Supabase SQL Editor after 067-071. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- The broker's own private clients (from other Realtors / his own book).
CREATE TABLE IF NOT EXISTS public.broker_clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id         UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name              TEXT,
  email             TEXT,
  phone             TEXT,
  status            TEXT NOT NULL DEFAULT 'active',   -- active | moved_to_agent
  max_amount        NUMERIC,
  prequal_status    TEXT,                             -- pre_approved | conditional | soft_prequal | declined
  rate_hold         DATE,
  notes             TEXT,
  moved_to_agent_id UUID,
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

-- Maxwell's link to his primary broker (for the "Transfer to Asare" button).
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS broker_account_id UUID;

-- "Move to Maxwell": the broker pushes one of his OWN clients to his Realtor.
-- SECURITY DEFINER because the broker can't insert a row the Realtor owns; it
-- re-checks ownership + that the target Realtor is the one who set the broker up.
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
