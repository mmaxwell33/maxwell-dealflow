-- ─────────────────────────────────────────────────────────────────────────────
-- 127_disclosures_private.sql
-- Make the disclosures storage bucket private.
--
-- js/disclosure.js archives signed disclosure PDFs here (agent_id/<file>). The
-- bucket was created PUBLIC, so anyone holding a file's URL could read a signed
-- client document. Checked 2026-11-27: the bucket holds 0 files and the
-- disclosures table has 0 rows, so nothing was ever exposed.
--
-- After this: private, and an agent can read only files in their own folder
-- (the same rule the existing upload/update/delete policies use). Files are
-- opened through short-lived signed links (Disclosure.signedUrl).
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/127_disclosures_private.sql
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE storage.buckets SET public = false WHERE id = 'disclosures';

DROP POLICY IF EXISTS "Agents read their own disclosure files" ON storage.objects;
CREATE POLICY "Agents read their own disclosure files" ON storage.objects
  FOR SELECT TO authenticated
  USING ((bucket_id = 'disclosures') AND ((storage.foldername(name))[1] = (auth.uid())::text));

-- Check:
--   SELECT id, public FROM storage.buckets WHERE id = 'disclosures';   -- public = false

-- DOWN:
-- UPDATE storage.buckets SET public = true WHERE id = 'disclosures';
-- DROP POLICY IF EXISTS "Agents read their own disclosure files" ON storage.objects;
