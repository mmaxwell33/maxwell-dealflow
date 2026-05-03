-- Maxwell DealFlow — Client-level stakeholder contacts.
--
-- Captures each client's typical stakeholders (mortgage broker, lawyer,
-- inspector, builder) ONCE on the client record. Every future deal for
-- that client pre-fills the Add-Stakeholder invite modal — Maxwell just
-- picks the role and the name/email/phone fill themselves.
--
-- One row per (client_id, role). UPSERT on save.

CREATE TABLE IF NOT EXISTS client_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agent_id    uuid,
  role        text NOT NULL,           -- 'mortgage_broker' | 'inspector' | 'lawyer' | 'builder'
  name        text,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (client_id, role)
);

CREATE INDEX IF NOT EXISTS client_contacts_client_idx ON client_contacts (client_id);
CREATE INDEX IF NOT EXISTS client_contacts_agent_idx  ON client_contacts (agent_id);

-- Row-level security (mirrors clients table policy)
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see only their own client_contacts" ON client_contacts;
CREATE POLICY "Agents see only their own client_contacts"
  ON client_contacts FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);
