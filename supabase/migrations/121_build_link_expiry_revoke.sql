-- Migration 121: the buyer's build portal link (build.html) works like the
-- transaction portal link (stakeholder.html). It shows when it expires,
-- extends 90 days each time the buyer visits, and the buyer can revoke it
-- themselves if they did not ask for it. A revoke is logged so Maxwell sees it.

ALTER TABLE build_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Links already out start their 90 days today, so nobody is locked out
UPDATE build_tokens SET expires_at = now() + interval '90 days'
 WHERE active AND expires_at IS NULL;

ALTER TABLE build_tokens ALTER COLUMN expires_at SET DEFAULT now() + interval '90 days';

-- Called on each visit: extends the link 90 days, returns the new expiry
CREATE OR REPLACE FUNCTION build_portal_touch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_exp timestamptz;
BEGIN
  UPDATE build_tokens
     SET expires_at = now() + interval '90 days'
   WHERE token = p_token AND active
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING expires_at INTO v_exp;
  IF v_exp IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN jsonb_build_object('ok', true, 'expires_at', v_exp);
END $$;

-- The buyer revokes their own link; Maxwell sees it in the activity log
CREATE OR REPLACE FUNCTION build_self_revoke(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_build uuid; b new_builds%ROWTYPE;
BEGIN
  UPDATE build_tokens SET active = false, revoked_at = now()
   WHERE token = p_token AND active
  RETURNING build_id INTO v_build;
  IF v_build IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO b FROM new_builds WHERE id = v_build;
  -- Same columns App.logActivity writes; a logging failure never undoes the revoke
  BEGIN
    INSERT INTO activity_log (agent_id, client_id, client_name, activity_type, description)
    VALUES (b.agent_id, b.client_id, b.client_name, 'BUILD_LINK_REVOKED',
            'Build portal link for ' || coalesce(b.lot_address, 'a build') || ' was revoked by the person holding it. Send a new link if it was the buyer.');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION build_portal_touch(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION build_self_revoke(text)  TO anon, authenticated;
