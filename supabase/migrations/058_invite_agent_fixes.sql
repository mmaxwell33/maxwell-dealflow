-- ============================================================
-- Migration 058: Invite-agent fixes
--   (1) Close the Money Brief (briefings) leak — migration 037 made it
--       readable by ANY authenticated agent, which would expose the founder's
--       financial briefs to an invited agent (e.g. George).
--   (2) Let a founder see the agents they created, so the Agent Portal
--       "Deployed Agents" list actually populates.
--
-- Apply via the Supabase SQL editor (db push is out of sync on this project).
-- Safe to re-run.
-- ============================================================

-- ── (0) ensure agents.created_by exists ──────────────────────────────────────
-- The agents table was created without this column, which is why the old invite
-- silently failed (it wrote to a column that didn't exist). Nullable: existing
-- rows (the founder) stay NULL; invited agents get the inviter's id.
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS created_by uuid;

-- ── (1) briefings: only the founder account may read ─────────────────────────
-- The founder is the agent whose own agents row has created_by IS NULL
-- (invited agents always have created_by set to whoever invited them).
-- This keeps Maxwell's Money Brief working while blocking every invited agent.
-- Note: the nested SELECT is itself filtered by the agents RLS ("agents_own":
-- auth.uid() = id), so each caller can only match their OWN agents row — the
-- created_by IS NULL check is what separates founder from invited agent.
DROP POLICY IF EXISTS "briefings_read_authenticated" ON public.briefings;
DROP POLICY IF EXISTS "briefings_founder_read" ON public.briefings;
CREATE POLICY "briefings_founder_read"
  ON public.briefings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = auth.uid() AND a.created_by IS NULL
    )
  );

-- ── (2) agents: a founder can read the agents they created ───────────────────
-- Existing "agents_own" (auth.uid() = id) already lets everyone read their own
-- row. This ADDS read access to rows you created, so the Deployed Agents list
-- shows the agents you've invited. RLS combines SELECT policies with OR, so an
-- invited agent still sees only their own row.
DROP POLICY IF EXISTS "agents_created_by_read" ON public.agents;
CREATE POLICY "agents_created_by_read"
  ON public.agents FOR SELECT
  USING (created_by = auth.uid());

-- ── Verify (optional) ────────────────────────────────────────────────────────
-- Confirm your own account is recognised as the founder (should return 1 row):
--   SELECT id, full_name, created_by FROM public.agents WHERE created_by IS NULL;
-- Confirm the policies exist:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('briefings','agents') ORDER BY tablename, policyname;
