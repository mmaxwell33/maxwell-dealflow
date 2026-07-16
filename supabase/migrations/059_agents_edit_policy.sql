-- ============================================================
-- Migration 059: let a founder EDIT the agents they created
--
-- Existing policies: "agents_own" (auth.uid() = id) — read/write your own row;
-- "agents_created_by_read" (058) — read rows you created. This adds the ability
-- to UPDATE rows you created, so the Agent Portal "Edit" button can fix an
-- invited agent's name / phone / brokerage / title.
--
-- Apply via the Supabase SQL editor. Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS "agents_created_by_write" ON public.agents;
CREATE POLICY "agents_created_by_write"
  ON public.agents FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
