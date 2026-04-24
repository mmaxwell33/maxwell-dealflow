-- Maxwell DealFlow — 018 Builder Portal
-- Adds secure, token-gated portal for builders to update new-build progress
-- and request client visits. 90-day token expiry. All client actions still
-- flow through the existing Approvals tab — no auto-sends.

-- ── 1. Extend new_builds ───────────────────────────────────────────────────
ALTER TABLE new_builds
  ADD COLUMN IF NOT EXISTS builder_email         TEXT,
  ADD COLUMN IF NOT EXISTS builder_token         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS builder_token_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS builder_token_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_new_builds_builder_token
  ON new_builds(builder_token) WHERE builder_token IS NOT NULL;

-- ── 2. Builder visit-request queue ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS builder_visit_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id         UUID REFERENCES new_builds(id) ON DELETE CASCADE,
  agent_id         UUID REFERENCES agents(id)     ON DELETE CASCADE,
  stage_item_label TEXT,
  proposed_date    DATE,
  proposed_time    TIME,
  builder_note     TEXT,
  status           TEXT DEFAULT 'pending',
    -- pending → waiting for Maxwell to approve in Approvals tab
    -- approved → Maxwell accepted, email queued to client
    -- rescheduled → Maxwell proposed new time
    -- declined → Maxwell rejected
  agent_response   TEXT,
  final_date       DATE,
  final_time       TIME,
  approval_id      UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  responded_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bvr_build ON builder_visit_requests(build_id);
CREATE INDEX IF NOT EXISTS idx_bvr_status ON builder_visit_requests(status);

-- ── 3. Builder activity log (per-step check + comments + custom items) ────
CREATE TABLE IF NOT EXISTS builder_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id        UUID REFERENCES new_builds(id) ON DELETE CASCADE,
  stage_key       TEXT,
  step_key        TEXT,
  action          TEXT,    -- checked | unchecked | commented | custom_added | visit_requested
  comment         TEXT,
  custom_label    TEXT,
  custom_due_date DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_builder_updates_build ON builder_updates(build_id);
CREATE INDEX IF NOT EXISTS idx_builder_updates_created ON builder_updates(created_at DESC);

-- ── 4. RLS: builder can only access rows where token matches ──────────────
ALTER TABLE builder_visit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_updates        ENABLE ROW LEVEL SECURITY;

-- Builder anon access via token match on linked new_builds row.
-- Anon client must always filter by build_id AND include token verification
-- via the /rest RPC wrapper, OR (simpler) we rely on short unguessable UUIDs
-- like the existing build_tokens pattern. For the portal page we use a
-- security-definer RPC so the anon key can only read/write its own build.

DROP POLICY IF EXISTS bvr_agent_all ON builder_visit_requests;
CREATE POLICY bvr_agent_all ON builder_visit_requests
  FOR ALL TO authenticated
  USING (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

DROP POLICY IF EXISTS bu_agent_all ON builder_updates;
CREATE POLICY bu_agent_all ON builder_updates
  FOR ALL TO authenticated
  USING (build_id IN (SELECT id FROM new_builds WHERE agent_id = auth.uid()))
  WITH CHECK (build_id IN (SELECT id FROM new_builds WHERE agent_id = auth.uid()));

-- ── 5. Security-definer RPCs for anon builder access ──────────────────────
-- All builder writes go through these functions — they verify the token
-- matches the build AND the token hasn't expired. This keeps RLS simple
-- and prevents a builder from ever touching another build's row.

CREATE OR REPLACE FUNCTION builder_load(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build       new_builds%ROWTYPE;
  v_requests    JSONB;
  v_updates     JSONB;
BEGIN
  SELECT * INTO v_build
  FROM new_builds
  WHERE builder_token = p_token
    AND (builder_token_expires IS NULL OR builder_token_expires > NOW());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_or_expired');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_requests
    FROM builder_visit_requests r WHERE r.build_id = v_build.id;

  SELECT COALESCE(jsonb_agg(u ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_updates
    FROM builder_updates u WHERE u.build_id = v_build.id;

  RETURN jsonb_build_object(
    'build', jsonb_build_object(
      'id',                   v_build.id,
      'lot_address',          v_build.lot_address,
      'builder_name',         v_build.builder_name,
      'current_stage',        v_build.current_stage,
      'pipeline_milestones',  v_build.pipeline_milestones,
      'stage_history',        v_build.stage_history,
      'est_completion_date',  v_build.est_completion_date,
      'updated_at',           v_build.updated_at
    ),
    'visit_requests', v_requests,
    'builder_updates', v_updates
  );
END;
$$;

CREATE OR REPLACE FUNCTION builder_check_step(
  p_token TEXT, p_stage_key TEXT, p_step_key TEXT, p_checked BOOLEAN, p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build_id UUID;
  v_pm       JSONB;
BEGIN
  SELECT id, COALESCE(pipeline_milestones, '{}'::jsonb) INTO v_build_id, v_pm
  FROM new_builds
  WHERE builder_token = p_token
    AND (builder_token_expires IS NULL OR builder_token_expires > NOW());

  IF v_build_id IS NULL THEN RETURN jsonb_build_object('error','invalid_or_expired'); END IF;

  -- Ensure nested structure exists
  IF v_pm -> p_stage_key IS NULL THEN
    v_pm := v_pm || jsonb_build_object(p_stage_key, jsonb_build_object('done', false, 'steps', '{}'::jsonb));
  END IF;
  IF v_pm #> ARRAY[p_stage_key,'steps'] IS NULL THEN
    v_pm := jsonb_set(v_pm, ARRAY[p_stage_key,'steps'], '{}'::jsonb);
  END IF;
  v_pm := jsonb_set(v_pm, ARRAY[p_stage_key,'steps',p_step_key], to_jsonb(p_checked));

  UPDATE new_builds
     SET pipeline_milestones = v_pm,
         updated_at = NOW()
   WHERE id = v_build_id;

  INSERT INTO builder_updates (build_id, stage_key, step_key, action, comment)
  VALUES (v_build_id, p_stage_key, p_step_key, CASE WHEN p_checked THEN 'checked' ELSE 'unchecked' END, p_comment);

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION builder_add_custom(
  p_token TEXT, p_label TEXT, p_due DATE DEFAULT NULL, p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build_id UUID;
  v_history  JSONB;
BEGIN
  SELECT id, COALESCE(stage_history, '[]'::jsonb) INTO v_build_id, v_history
  FROM new_builds
  WHERE builder_token = p_token
    AND (builder_token_expires IS NULL OR builder_token_expires > NOW());

  IF v_build_id IS NULL THEN RETURN jsonb_build_object('error','invalid_or_expired'); END IF;

  v_history := v_history || jsonb_build_array(jsonb_build_object(
    'label', p_label, 'custom', true, 'due_date', p_due, 'added_by', 'builder', 'added_at', NOW()
  ));

  UPDATE new_builds SET stage_history = v_history, updated_at = NOW() WHERE id = v_build_id;

  INSERT INTO builder_updates (build_id, action, custom_label, custom_due_date, comment)
  VALUES (v_build_id, 'custom_added', p_label, p_due, p_comment);

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION builder_request_visit(
  p_token TEXT, p_stage_item TEXT, p_date DATE, p_time TIME, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build_id UUID;
  v_agent_id UUID;
  v_req_id   UUID;
BEGIN
  SELECT id, agent_id INTO v_build_id, v_agent_id
  FROM new_builds
  WHERE builder_token = p_token
    AND (builder_token_expires IS NULL OR builder_token_expires > NOW());

  IF v_build_id IS NULL THEN RETURN jsonb_build_object('error','invalid_or_expired'); END IF;

  INSERT INTO builder_visit_requests (build_id, agent_id, stage_item_label, proposed_date, proposed_time, builder_note)
  VALUES (v_build_id, v_agent_id, p_stage_item, p_date, p_time, p_note)
  RETURNING id INTO v_req_id;

  INSERT INTO builder_updates (build_id, action, comment)
  VALUES (v_build_id, 'visit_requested',
          'Requested ' || p_date::text || ' ' || p_time::text || COALESCE(' — '||p_note, ''));

  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id);
END;
$$;

-- Grant anon execute on the RPCs (token gives all the auth we need)
GRANT EXECUTE ON FUNCTION builder_load(TEXT)                                  TO anon;
GRANT EXECUTE ON FUNCTION builder_check_step(TEXT,TEXT,TEXT,BOOLEAN,TEXT)     TO anon;
GRANT EXECUTE ON FUNCTION builder_add_custom(TEXT,TEXT,DATE,TEXT)             TO anon;
GRANT EXECUTE ON FUNCTION builder_request_visit(TEXT,TEXT,DATE,TIME,TEXT)     TO anon;
