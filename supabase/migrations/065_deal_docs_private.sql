-- Migration 065: make deal documents PRIVATE (close the public-bucket leak)
--
-- Boardroom Session 03 — Sprint 0 safety fix.
--
-- Problem: the 'deal-docs' bucket was created PUBLIC (migration 033) with only
-- INSERT/UPDATE/DELETE storage policies and NO SELECT policy — the public flag
-- was the only thing letting reads through. Real signed offers / financing docs
-- were world-readable by anyone holding the (guessable-if-leaked) URL.
--
-- Fix, in the ONLY safe order:
--   1. FIRST add a SELECT policy so authenticated agents can still read (and sign
--      URLs for) their OWN files once the bucket is private.
--   2. THEN flip the bucket to private.
--
-- Why this is safe to run on live prod:
--   • The live stakeholder portal (js/stakeholder-portal-v2.js) does NOT render
--     deal documents, so no client-facing link breaks.
--   • Every agent-side read is authenticated: openDocs/viewDoc, the PDF-bundle
--     downloads (offers.js:1123, 4099) and the portal-email base64 attach
--     (extras.js:2987) all call db.storage.from('deal-docs') while logged in —
--     the SELECT policy below covers them (own-folder only).
--   • Idempotent: safe to re-run.
--
-- Verify after running (as Maxwell, logged in):
--   • Open a deal → 📄 Docs → 👁 Open on a file → it opens in a new tab.
--   • The Approvals/portal-email flow still attaches deal docs.

-- ── 1. SELECT policy: agents read only files inside their own agent_id folder ──
DROP POLICY IF EXISTS "Agents read their own deal files" ON storage.objects;
CREATE POLICY "Agents read their own deal files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'deal-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 2. Flip the bucket to private (do this AFTER the SELECT policy exists) ──
UPDATE storage.buckets SET public = false WHERE id = 'deal-docs';

-- NOTE (deferred to the GATED "send docs to stakeholders" feature, Fix 3):
-- when the stakeholder portal is wired to actually display documents, replace
-- deal_doc_public_url() in stakeholder_resolve() with a service-role edge
-- function that re-checks the token + visible_to_roles and mints a short-lived
-- signed URL ON CLICK. Until then the portal renders no doc links, so the dead
-- public URL that stakeholder_resolve still returns is simply never consumed.
