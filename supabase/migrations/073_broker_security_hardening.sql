-- ─────────────────────────────────────────────────────────────────────────────
-- 073_broker_security_hardening.sql — P0 HARD GATE (Boardroom Session 10).
-- Run this in the Supabase SQL Editor BEFORE any external broker login exists.
-- Closes the two holes the board flagged. Safe to re-run.
--
-- (1) client_responses LEAK. Migration 004 created:
--       "anon_read_own_response"  FOR SELECT USING (true)      -- no TO clause
--       "anon_insert_responses"   FOR INSERT WITH CHECK (true) -- no TO clause
--     A policy with no TO clause applies to EVERY role incl. authenticated, and
--     RLS is permissive-OR, so any logged-in user can read/insert EVERY row —
--     every client's viewing responses + offer amounts. The only legitimate
--     reader is the Responses screen (an authenticated agent, already covered by
--     the agent_own_responses policy), and nothing writes to the table (legacy).
--     Fix per Kwame: DROP the open policies (NOT "add TO anon" — the anon key is
--     public, so that just renames the hole) and revoke anon.
--
-- (2) agents ROLE-ESCALATION hole. RLS cannot restrict COLUMNS, so a broker with
--     his own JWT + the public anon key could PATCH his own agents row to
--     role='founder' / created_by=NULL and read the Money Brief. A BEFORE UPDATE
--     trigger blocks any change to role/created_by unless it's the service role
--     (edge fns / migrations) or the founder managing an agent they created.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) Close the client_responses leak
DROP POLICY IF EXISTS "anon_read_own_response" ON public.client_responses;
DROP POLICY IF EXISTS "anon_insert_responses"  ON public.client_responses;
REVOKE ALL ON public.client_responses FROM anon;
-- agent_own_responses (agent_id = auth.uid()) remains — the only access path.

-- (2) Block role / created_by escalation from any normal user session
CREATE OR REPLACE FUNCTION public._guard_agent_privileged_cols()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- service role (edge functions like invite-agent, SQL editor, migrations)
  -- has no end-user JWT, so auth.uid() is NULL — allow it through.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    -- Allowed ONLY when the caller created this agent row (founder managing an
    -- invitee, e.g. setupBrokerLogin stamping role='broker'). A broker editing
    -- his OWN row (created_by = Maxwell, not himself) is blocked.
    IF OLD.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Changing role/created_by is not permitted from this session.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_agent_privileged_cols ON public.agents;
CREATE TRIGGER guard_agent_privileged_cols
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public._guard_agent_privileged_cols();

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY (run after applying — the leak query MUST return 0 rows):
--   SELECT polname FROM pg_policy
--    WHERE polrelid='public.client_responses'::regclass AND polcmd='r'
--      AND pg_get_expr(polqual,polrelid)='true';                 -- expect 0 rows
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.agents'::regclass
--      AND tgname='guard_agent_privileged_cols';                 -- expect 1 row
-- ─────────────────────────────────────────────────────────────────────────────
