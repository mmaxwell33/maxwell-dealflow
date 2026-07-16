-- ============================================================
-- Migration 060: isolate client_intake (Form Responses) per agent
--
-- The live read policy on client_intake is "auth.uid() IS NOT NULL" — i.e. ANY
-- logged-in agent can read EVERY intake submission. With a second agent now
-- provisioned, they see the founder's leads (confirmed in Form Responses).
--
-- Fix: give client_intake an agent_id, backfill existing rows to the founder,
-- default new public submissions to the founder, and scope read/update/delete
-- to the owning agent. The public submit path is a SECURITY DEFINER RPC
-- (submit_intake) that bypasses RLS, so new submissions still work.
--
-- Apply via the Supabase SQL editor. Safe to re-run.
-- ============================================================

ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS agent_id uuid;

-- Backfill existing submissions + set the default to the FOUNDER (the agent
-- whose own row has created_by IS NULL). Done dynamically so no UUID is hardcoded.
DO $$
DECLARE founder uuid;
BEGIN
  SELECT id INTO founder
    FROM public.agents
    WHERE created_by IS NULL
    ORDER BY created_at NULLS FIRST
    LIMIT 1;

  IF founder IS NOT NULL THEN
    UPDATE public.client_intake SET agent_id = founder WHERE agent_id IS NULL;
    EXECUTE format('ALTER TABLE public.client_intake ALTER COLUMN agent_id SET DEFAULT %L', founder);
  END IF;
END $$;

-- Replace the permissive policies with agent-scoped ones.
DROP POLICY IF EXISTS "intake_read_own"        ON public.client_intake;
DROP POLICY IF EXISTS "intake_read_own_agent"  ON public.client_intake;
DROP POLICY IF EXISTS "intake_update_own"      ON public.client_intake;
DROP POLICY IF EXISTS "intake_update_own_agent" ON public.client_intake;
DROP POLICY IF EXISTS "intake_delete_own"      ON public.client_intake;
DROP POLICY IF EXISTS "intake_delete_own_agent" ON public.client_intake;

CREATE POLICY "intake_read_own_agent"
  ON public.client_intake FOR SELECT TO authenticated
  USING (agent_id = auth.uid());

CREATE POLICY "intake_update_own_agent"
  ON public.client_intake FOR UPDATE TO authenticated
  USING (agent_id = auth.uid()) WITH CHECK (agent_id = auth.uid());

CREATE POLICY "intake_delete_own_agent"
  ON public.client_intake FOR DELETE TO authenticated
  USING (agent_id = auth.uid());

-- Verify (optional): should return only YOUR rows when signed in as an agent.
--   SELECT count(*) FROM public.client_intake;
