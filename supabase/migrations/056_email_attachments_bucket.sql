-- Migration 056: private bucket for transient email attachments
-- Large attachments (e.g. a signed APS) can't be stored inline as base64 in the
-- approval_queue row — the insert fails. Instead we stage them here at queue time,
-- download + attach at send time, then delete. Private bucket (not public), so a
-- staged file is never reachable by URL — only the owning agent can read it.

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Agent can manage ONLY their own staged files (path must start with their uid).
DROP POLICY IF EXISTS "email_attach_own" ON storage.objects;
CREATE POLICY "email_attach_own" ON storage.objects
  FOR ALL
  USING      (bucket_id = 'email-attachments' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'email-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
