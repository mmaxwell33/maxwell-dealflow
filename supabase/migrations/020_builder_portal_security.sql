-- Maxwell DealFlow — 020 Builder Portal Security
-- Adds: access log (IP + UA), builder self-revoke RPC, agent-visible last-seen,
-- activity log helper. Rolling 90-day expiry: every portal open slides the
-- token expiry forward 90 days from that moment (auto-kills if unused for 90d).

-- ── 1. Access log table (every portal load) ────────────────────────────────
CREATE TABLE IF NOT EXISTS builder_access_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id   UUID REFERENCES new_builds(id) ON DELETE CASCADE,
  ip         TEXT,
  user_agent TEXT,
  opened_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bal_build_opened
  ON builder_access_log(build_id, opened_at DESC);

ALTER TABLE builder_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bal_agent_read ON builder_access_log;
CREATE POLICY bal_agent_read ON builder_access_log
  FOR SELECT TO authenticated
  USING (build_id IN (SELECT id FROM new_builds WHERE agent_id = auth.uid()));

-- ── 2. RPC: log a portal open (called from builder.html on load) ──────────
CREATE OR REPLACE FUNCTION builder_log_access(
  p_token TEXT,
  p_ua    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build_id UUID;
  v_ip       TEXT;
BEGIN
  SELECT id INTO v_build_id FROM new_builds
  WHERE builder_token = p_token
    AND (builder_token_expires IS NULL OR builder_token_expires > NOW());
  IF v_build_id IS NULL THEN RETURN jsonb_build_object('error','invalid_or_expired'); END IF;

  -- Supabase forwards caller IP via current_setting
  BEGIN
    v_ip := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  INSERT INTO builder_access_log (build_id, ip, user_agent)
  VALUES (v_build_id, v_ip, LEFT(COALESCE(p_ua,''), 400));

  -- Rolling 90-day expiry: every portal open slides the expiry forward.
  -- If the builder stops using the link, it auto-kills 90 days after last use.
  UPDATE new_builds
     SET builder_token_expires = NOW() + INTERVAL '90 days'
   WHERE id = v_build_id;

  RETURN jsonb_build_object('ok', true, 'expires_at', NOW() + INTERVAL '90 days');
END;
$$;

-- ── 3. RPC: builder self-revokes the link (panic button) ───────────────────
CREATE OR REPLACE FUNCTION builder_self_revoke(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM new_builds WHERE builder_token = p_token;
  IF v_id IS NULL THEN RETURN jsonb_build_object('error','already_invalid'); END IF;

  UPDATE new_builds
     SET builder_token = NULL,
         builder_token_expires = NULL
   WHERE id = v_id;

  INSERT INTO builder_updates (build_id, action, comment)
  VALUES (v_id, 'self_revoked', 'Builder self-revoked the link (panic button).');

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 4. RPC: agent-facing access summary (count, last seen, unique IPs) ────
CREATE OR REPLACE FUNCTION builder_access_summary(p_build_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total         INT;
  v_last          TIMESTAMPTZ;
  v_week          INT;
  v_unique_24h    INT;
BEGIN
  -- Only the owning agent may call
  IF NOT EXISTS (SELECT 1 FROM new_builds WHERE id = p_build_id AND agent_id = auth.uid()) THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;

  SELECT COUNT(*), MAX(opened_at) INTO v_total, v_last
    FROM builder_access_log WHERE build_id = p_build_id;

  SELECT COUNT(*) INTO v_week
    FROM builder_access_log
   WHERE build_id = p_build_id AND opened_at > NOW() - INTERVAL '7 days';

  SELECT COUNT(DISTINCT ip) INTO v_unique_24h
    FROM builder_access_log
   WHERE build_id = p_build_id
     AND opened_at > NOW() - INTERVAL '24 hours'
     AND ip IS NOT NULL;

  RETURN jsonb_build_object(
    'total_opens', COALESCE(v_total, 0),
    'last_opened', v_last,
    'opens_this_week', COALESCE(v_week, 0),
    'unique_ips_24h', COALESCE(v_unique_24h, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION builder_log_access(TEXT, TEXT)  TO anon;
GRANT EXECUTE ON FUNCTION builder_self_revoke(TEXT)       TO anon;
GRANT EXECUTE ON FUNCTION builder_access_summary(UUID)    TO authenticated;
