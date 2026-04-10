-- ============================================================
-- Migration 007: Security & RLS Hardening
-- Tighten Row Level Security on all tables so the anon key
-- can ONLY read/write rows belonging to the authenticated agent.
-- Also locks down the client_intake table.
-- ============================================================

-- ── AGENTS ───────────────────────────────────────────────────
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_own" ON agents;
CREATE POLICY "agents_own" ON agents
  FOR ALL USING (auth.uid() = id);

-- ── CLIENTS ──────────────────────────────────────────────────
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clients_own" ON clients;
CREATE POLICY "clients_own" ON clients
  FOR ALL USING (auth.uid() = agent_id);

-- ── VIEWINGS ─────────────────────────────────────────────────
ALTER TABLE viewings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewings_own" ON viewings;
CREATE POLICY "viewings_own" ON viewings
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE agent_id = auth.uid()
    )
  );

-- ── OFFERS ───────────────────────────────────────────────────
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "offers_own" ON offers;
CREATE POLICY "offers_own" ON offers
  FOR ALL USING (agent_id = auth.uid());

-- ── PIPELINE ─────────────────────────────────────────────────
ALTER TABLE pipeline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_own" ON pipeline;
CREATE POLICY "pipeline_own" ON pipeline
  FOR ALL USING (agent_id = auth.uid());

-- ── APPROVAL QUEUE ───────────────────────────────────────────
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "approvals_own" ON approval_queue;
CREATE POLICY "approvals_own" ON approval_queue
  FOR ALL USING (agent_id = auth.uid());

-- ── EMAIL INBOX ──────────────────────────────────────────────
ALTER TABLE email_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbox_own" ON email_inbox;
CREATE POLICY "inbox_own" ON email_inbox
  FOR ALL USING (agent_id = auth.uid());

-- ── ACTIVITY LOG ─────────────────────────────────────────────
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_own" ON activity_log;
CREATE POLICY "activity_own" ON activity_log
  FOR ALL USING (agent_id = auth.uid());

-- ── NEW BUILDS ───────────────────────────────────────────────
ALTER TABLE new_builds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "new_builds_own" ON new_builds;
CREATE POLICY "new_builds_own" ON new_builds
  FOR ALL USING (agent_id = auth.uid());

-- ── CLIENT INTAKE ────────────────────────────────────────────
-- Public insert (anyone can submit intake form)
-- but only authenticated agent can read/update/delete
ALTER TABLE client_intake ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_insert_public" ON client_intake;
CREATE POLICY "intake_insert_public" ON client_intake
  FOR INSERT WITH CHECK (true);  -- anyone can submit the form

DROP POLICY IF EXISTS "intake_read_own" ON client_intake;
CREATE POLICY "intake_read_own" ON client_intake
  FOR SELECT USING (auth.uid() IS NOT NULL);  -- only logged-in agents can read

DROP POLICY IF EXISTS "intake_update_own" ON client_intake;
CREATE POLICY "intake_update_own" ON client_intake
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "intake_delete_own" ON client_intake;
CREATE POLICY "intake_delete_own" ON client_intake
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ── DEAL CHECKLIST ───────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'deal_checklist') THEN
    ALTER TABLE deal_checklist ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "checklist_own" ON deal_checklist;
    CREATE POLICY "checklist_own" ON deal_checklist
      FOR ALL USING (agent_id = auth.uid());
  END IF;
END $$;

-- ── COMMISSIONS ──────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commissions') THEN
    ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "commissions_own" ON commissions;
    CREATE POLICY "commissions_own" ON commissions
      FOR ALL USING (agent_id = auth.uid());
  END IF;
END $$;
