-- Migration 057: per-client document folder (Phase 1)
-- Every document tied to a client, organized by category. The "folder" is virtual —
-- it's simply all client_documents rows for a client_id. Files live in a PRIVATE
-- bucket so they're only reachable through the app via short-lived signed URLs.

CREATE TABLE IF NOT EXISTS client_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         uuid NOT NULL,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category         text NOT NULL DEFAULT 'other',  -- preapproval|offer_letter|mls|aps|rejected_offer|id_kyc|intake|other
  property_address text,                            -- optional, for offer/property docs
  status           text,                            -- optional, e.g. 'Offer Rejected'
  source           text DEFAULT 'manual',           -- manual|intake|offer|acceptance
  file_path        text NOT NULL,                   -- storage path in client-docs bucket
  file_name        text,
  file_size_bytes  bigint,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_documents_client_idx ON client_documents(client_id);
CREATE INDEX IF NOT EXISTS client_documents_agent_idx  ON client_documents(agent_id);

ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_docs_own" ON client_documents;
CREATE POLICY "client_docs_own" ON client_documents
  FOR ALL
  USING      (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- Private storage bucket for the files themselves
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-docs', 'client-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Agent can manage ONLY their own files (path must start with their user id)
DROP POLICY IF EXISTS "client_docs_storage_own" ON storage.objects;
CREATE POLICY "client_docs_storage_own" ON storage.objects
  FOR ALL
  USING      (bucket_id = 'client-docs' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'client-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
