-- Maxwell DealFlow — 019 Builder Visit Loop
-- Lets the builder respond to agent's reschedule (accept or counter-propose).
-- All via security-definer RPCs so builder stays anon (token-gated only).

-- ── 1. Builder accepts the agent's counter-proposal ────────────────────────
CREATE OR REPLACE FUNCTION builder_accept_reschedule(
  p_token TEXT,
  p_request_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build_id UUID;
  v_req      builder_visit_requests%ROWTYPE;
BEGIN
  -- Verify token matches a build that owns this request
  SELECT nb.id INTO v_build_id
  FROM new_builds nb
  JOIN builder_visit_requests r ON r.build_id = nb.id
  WHERE nb.builder_token = p_token
    AND (nb.builder_token_expires IS NULL OR nb.builder_token_expires > NOW())
    AND r.id = p_request_id;

  IF v_build_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_or_expired');
  END IF;

  -- Only allow accept if agent has actually proposed a new time
  SELECT * INTO v_req FROM builder_visit_requests WHERE id = p_request_id;
  IF v_req.status <> 'rescheduled' THEN
    RETURN jsonb_build_object('error', 'not_rescheduled');
  END IF;

  -- Builder accepts: final_date/final_time already hold agent's proposed time
  UPDATE builder_visit_requests
     SET status = 'approved',
         builder_note = COALESCE(builder_note, '') || ' [Builder accepted agent reschedule]',
         responded_at = NOW()
   WHERE id = p_request_id;

  INSERT INTO builder_updates (build_id, action, comment)
  VALUES (v_build_id, 'visit_accepted_by_builder',
          'Builder accepted agent''s proposed time: ' || v_req.final_date::text || ' ' || COALESCE(v_req.final_time::text, ''));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 2. Builder counter-proposes a new time (after agent reschedule) ────────
CREATE OR REPLACE FUNCTION builder_counter_reschedule(
  p_token TEXT,
  p_request_id UUID,
  p_date DATE,
  p_time TIME,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_build_id UUID;
BEGIN
  SELECT nb.id INTO v_build_id
  FROM new_builds nb
  JOIN builder_visit_requests r ON r.build_id = nb.id
  WHERE nb.builder_token = p_token
    AND (nb.builder_token_expires IS NULL OR nb.builder_token_expires > NOW())
    AND r.id = p_request_id;

  IF v_build_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_or_expired');
  END IF;

  -- Reset to pending so agent sees the new counter on their banner
  UPDATE builder_visit_requests
     SET status = 'pending',
         proposed_date = p_date,
         proposed_time = p_time,
         builder_note  = COALESCE(p_note, 'Builder proposed a different time'),
         final_date    = NULL,
         final_time    = NULL,
         agent_response = NULL,
         responded_at  = NULL
   WHERE id = p_request_id;

  INSERT INTO builder_updates (build_id, action, comment)
  VALUES (v_build_id, 'visit_counter_proposed',
          'Builder counter-proposed: ' || p_date::text || ' ' || p_time::text || COALESCE(' — ' || p_note, ''));

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION builder_accept_reschedule(TEXT, UUID)                     TO anon;
GRANT EXECUTE ON FUNCTION builder_counter_reschedule(TEXT, UUID, DATE, TIME, TEXT)  TO anon;
