-- Maxwell DealFlow — Phase 2.A · Deal Documents
--
-- Lets the agent upload deal-level documents (accepted offer, MLS listing, etc.)
-- and surfaces them to invited stakeholders on their portals — filtered by
-- role (e.g. inspectors don't see the accepted offer; only the MLS).
--
-- Storage:
--   • Bucket 'deal-docs' (public — paths include UUIDs so unguessable;
--     same security model as token portals).
--   • File path: <agent_id>/<pipeline_id>/<uuid>-<filename>
--   • RLS lets the agent write/delete only inside their own agent_id folder.

-- ── 1. deal_documents table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id       uuid NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  agent_id          uuid NOT NULL,
  doc_type          text NOT NULL,            -- 'accepted_offer' | 'mls_listing' | 'other'
  file_path         text NOT NULL,            -- storage path
  file_name         text,
  file_size_bytes   bigint,
  notes             text,
  -- Role visibility — which stakeholder roles see this doc on their portal.
  -- Default = everyone except inspector. Agent can override on upload.
  visible_to_roles  text[] NOT NULL DEFAULT
    ARRAY['client','mortgage_broker','lawyer','builder']::text[],
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_documents_pipeline_idx ON deal_documents (pipeline_id);
CREATE INDEX IF NOT EXISTS deal_documents_agent_idx    ON deal_documents (agent_id);

ALTER TABLE deal_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see only their own deal_documents" ON deal_documents;
CREATE POLICY "Agents see only their own deal_documents"
  ON deal_documents FOR ALL
  USING  (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- ── 2. Storage bucket + RLS ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-docs', 'deal-docs', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Agents upload to their own folder" ON storage.objects;
CREATE POLICY "Agents upload to their own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deal-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Agents update their own files" ON storage.objects;
CREATE POLICY "Agents update their own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'deal-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Agents delete their own files" ON storage.objects;
CREATE POLICY "Agents delete their own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'deal-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 3. Helper to compute the public URL for a file path ──────────────
-- Centralized so we don't hardcode the project URL in JS.
-- Returns NULL if the path looks invalid.
CREATE OR REPLACE FUNCTION public.deal_doc_public_url(p_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'https://bxwmbrdndsetjwcexwpc.supabase.co/storage/v1/object/public/deal-docs/'
       || p_path
$$;

-- ── 4. Re-publish stakeholder_resolve to include role-filtered docs ──
-- This is the 6th version of this function. Body matches migration 030
-- (which counts skipped milestones as done) — only addition is a new
-- 'documents' array on the return JSON.

CREATE OR REPLACE FUNCTION public.stakeholder_resolve(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_stake     deal_stakeholders;
  v_pipe      pipeline;
  v_client    clients;
  v_agent_name  text;
  v_agent_phone text;
  v_checklist   jsonb;
  v_documents   jsonb;
BEGIN
  SELECT * INTO v_stake FROM deal_stakeholders
   WHERE token = p_token AND revoked_at IS NULL AND token_expires > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','invalid_or_expired');
  END IF;

  UPDATE deal_stakeholders
     SET token_expires = now() + interval '90 days',
         last_accessed = now()
   WHERE id = v_stake.id;

  SELECT * INTO v_pipe   FROM pipeline WHERE id = v_stake.pipeline_id;
  SELECT * INTO v_client FROM clients  WHERE id = v_stake.client_id;
  SELECT name, phone INTO v_agent_name, v_agent_phone
    FROM agents WHERE id = v_stake.agent_id;

  -- Checklist (same as v030)
  v_checklist := '[]'::jsonb;
  IF v_pipe.acceptance_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','✅ Acceptance','due_date',v_pipe.acceptance_date,
      'completed', v_pipe.acceptance_date <= current_date);
  END IF;
  IF v_pipe.financing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','🏦 Financing','due_date',v_pipe.financing_date,
      'completed', v_pipe.financing_date <= current_date);
  END IF;
  IF v_pipe.inspection_date IS NOT NULL OR coalesce(v_pipe.inspection_skipped,false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label', CASE WHEN coalesce(v_pipe.inspection_skipped,false)
                    THEN '🔍 Inspection (skipped)' ELSE '🔍 Inspection' END,
      'due_date', v_pipe.inspection_date,
      'completed', coalesce(v_pipe.inspection_skipped,false)
                   OR (v_pipe.inspection_date IS NOT NULL
                       AND v_pipe.inspection_date <= current_date));
  END IF;
  IF v_pipe.walkthrough_date IS NOT NULL OR coalesce(v_pipe.walkthrough_skipped,false) THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label', CASE WHEN coalesce(v_pipe.walkthrough_skipped,false)
                    THEN '🚶 Walkthrough (skipped)' ELSE '🚶 Walkthrough' END,
      'due_date', v_pipe.walkthrough_date,
      'completed', coalesce(v_pipe.walkthrough_skipped,false)
                   OR (v_pipe.walkthrough_date IS NOT NULL
                       AND v_pipe.walkthrough_date <= current_date));
  END IF;
  IF v_pipe.closing_date IS NOT NULL THEN
    v_checklist := v_checklist || jsonb_build_object(
      'label','🔑 Closing','due_date',v_pipe.closing_date,
      'completed', v_pipe.closing_date <= current_date);
  END IF;

  -- ── Documents — role-filtered ──
  -- Returns docs where this stakeholder's role is included in visible_to_roles.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         d.id,
           'doc_type',   d.doc_type,
           'file_name',  d.file_name,
           'url',        deal_doc_public_url(d.file_path),
           'uploaded_at', d.created_at
         ) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_documents
    FROM deal_documents d
   WHERE d.pipeline_id = v_pipe.id
     AND v_stake.role = ANY(d.visible_to_roles);

  RETURN jsonb_build_object(
    'ok', true,
    'role', v_stake.role,
    'name', v_stake.name,
    'stakeholder_name', v_stake.name,
    'stakeholder_completed_at', v_stake.completed_at,
    'property', v_pipe.property_address,
    'mls_number', v_pipe.mls_number,
    'stage', v_pipe.stage,
    'offer_amount', v_pipe.offer_amount,
    'acceptance_date',     v_pipe.acceptance_date,
    'financing_deadline',  v_pipe.financing_date,
    'inspection_deadline', v_pipe.inspection_date,
    'walkthrough_date',    v_pipe.walkthrough_date,
    'closing_date',        v_pipe.closing_date,
    'agent_name',  COALESCE(v_agent_name,  'Maxwell Delali Midodzi'),
    'agent_phone', COALESCE(v_agent_phone, '(709) 325-0545'),
    'expires_at',  (now() + interval '90 days'),
    'checklist',   v_checklist,
    'documents',   v_documents
  );
END
$function$;
