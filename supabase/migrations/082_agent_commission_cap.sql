-- ─────────────────────────────────────────────────────────────────────────────
-- 082_agent_commission_cap.sql
-- Maxwell (2026-07-22): eXp Realty caps the brokerage's annual cut. Once an agent
-- has paid their cap in brokerage fees for the year, they keep 100% of commission
-- (0% brokerage) for the rest of that year. Store the agent's cap on their row so
-- the commission screen can track progress and stop charging the fee once hit.
-- Default 16000 (Maxwell's eXp cap). Editable in the app.
--
-- Apply in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS commission_cap NUMERIC DEFAULT 16000;
