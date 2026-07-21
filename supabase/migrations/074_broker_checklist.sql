-- ─────────────────────────────────────────────────────────────────────────────
-- 074_broker_checklist.sql — Financing Lane Phase 1: monitoring, not storage.
-- A readiness checklist per REFERRED client so Asare (and Maxwell) can see how
-- far a referral has progressed. This tracks STATUS only — the actual documents
-- and client records live in Filogix (Asare's system of record). Mirrors the
-- existing deal_checklist pattern but isolated to the broker (broker_id = auth.uid()).
--
-- Apply in the Supabase SQL Editor after 073. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.broker_checklist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  ref_id      UUID NOT NULL,                    -- broker_referral_requests.id
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Financing',
  sort_order  INT  NOT NULL DEFAULT 0,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  custom      BOOLEAN NOT NULL DEFAULT false,   -- broker-added vs default item
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bcl_broker_ref_idx ON public.broker_checklist (broker_id, ref_id);
ALTER TABLE public.broker_checklist ENABLE ROW LEVEL SECURITY;

-- Only the broker who owns it sees/edits it. Maxwell (different uid) has no access.
DROP POLICY IF EXISTS "bcl broker own" ON public.broker_checklist;
CREATE POLICY "bcl broker own"
  ON public.broker_checklist FOR ALL
  TO authenticated
  USING (broker_id = auth.uid())
  WITH CHECK (broker_id = auth.uid());
