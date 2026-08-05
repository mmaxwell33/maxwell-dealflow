-- ─────────────────────────────────────────────────────────────────────────────
-- 086_product_updates.sql
-- "What's New" broadcast — when Maxwell ships something, every agent using
-- DealFlow (invited agents included) gets a push notification and a one-time
-- "What's New" card on next open, exactly like an App Store update note.
--
-- product_updates   — one row per announcement, posted by the founder only.
-- product_update_acks — per-agent "I've seen this" record, so it shows once
--   and persists across devices (a localStorage flag would not).
--
-- Writes to product_updates are NOT exposed via RLS to any role — the
-- broadcast-update edge function does the insert with the service role after
-- verifying the caller is the founder (agents.created_by IS NULL), the same
-- pattern invite-agent already uses. Every signed-in agent can read the table
-- so their client can check "is there something new since I last acked."
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posted_by   uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_updates_created_idx ON public.product_updates (created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_update_acks (
  update_id  uuid NOT NULL REFERENCES public.product_updates(id) ON DELETE CASCADE,
  agent_id   uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  acked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id, agent_id)
);

ALTER TABLE public.product_updates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_update_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Any signed-in agent reads updates" ON public.product_updates;
CREATE POLICY "Any signed-in agent reads updates"
  ON public.product_updates FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- No INSERT/UPDATE/DELETE policy on purpose: writes only happen via the
-- broadcast-update edge function's service-role client.

DROP POLICY IF EXISTS "Agents read own acks"   ON public.product_update_acks;
DROP POLICY IF EXISTS "Agents insert own acks" ON public.product_update_acks;
CREATE POLICY "Agents read own acks"
  ON public.product_update_acks FOR SELECT
  USING (agent_id = auth.uid());
CREATE POLICY "Agents insert own acks"
  ON public.product_update_acks FOR INSERT
  WITH CHECK (agent_id = auth.uid());
