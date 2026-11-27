-- ─────────────────────────────────────────────────────────────────────────────
-- 126_deal_room.sql
-- Transaction Room storage, one row per deal (js/dealroom.js).
--
-- The Room's parties list and document ticks lived only in the browser's
-- localStorage, so they did not follow Maxwell between his phone and laptop and
-- were lost when the browser was cleared. They now live here.
--
-- Its own table rather than deal_stakeholders: every deal_stakeholders row is a
-- portal invite with a token, and daily-automation emails a reminder to any
-- stakeholder who has not opened their portal. A Room party without a portal
-- would have been sent a reminder with a broken link.
--
--   parties   [{ "name", "role", "email", "phone" }, ...]
--   docs_done ["Title Search / Certificate", ...]   ticked documents, by name
--
-- Own rows only. Deleting a deal deletes its room.
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/126_deal_room.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deal_room (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL UNIQUE REFERENCES public.pipeline(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL,
  parties     jsonb NOT NULL DEFAULT '[]'::jsonb,
  docs_done   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_room_agent_idx ON public.deal_room(agent_id);

ALTER TABLE public.deal_room ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deal_room_own" ON public.deal_room;
CREATE POLICY "deal_room_own" ON public.deal_room
  FOR ALL TO authenticated
  USING      (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- DOWN: DROP TABLE IF EXISTS public.deal_room;
