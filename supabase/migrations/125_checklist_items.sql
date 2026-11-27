-- ─────────────────────────────────────────────────────────────────────────────
-- 125_checklist_items.sql
-- Maxwell's personal to-do list (the Checklist screen, js/tracker.js).
--
-- The screen has always read and written checklist_items, but the table was
-- never created, so the Checklist screen could not load or save anything.
-- This is NOT the per-deal checklist: that is deal_checklist.
--
-- Columns match exactly what js/tracker.js reads and writes. Own rows only.
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/125_checklist_items.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL,
  title       text NOT NULL,
  due_date    date,
  priority    text,
  client_name text,
  done        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_items_agent_idx ON public.checklist_items(agent_id, created_at DESC);

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checklist_items_own" ON public.checklist_items;
CREATE POLICY "checklist_items_own" ON public.checklist_items
  FOR ALL TO authenticated
  USING      (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- DOWN: DROP TABLE IF EXISTS public.checklist_items;
