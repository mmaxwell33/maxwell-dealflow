-- ─────────────────────────────────────────────────────────────────────────────
-- 051_builder_meetings.sql
-- Quick builder-meeting scheduler (like a viewing, but for meeting a builder).
-- client + builder + location + date/time. Shows on the Calendar, and an .ics
-- invite is emailed to the client (CC the builder).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meetings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name   TEXT,
  client_email  TEXT,
  builder_name  TEXT,
  builder_email TEXT,
  location      TEXT,
  meeting_date  DATE NOT NULL,
  meeting_time  TIME,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_agent_date_idx
  ON public.meetings (agent_id, meeting_date DESC);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents read own meetings"   ON public.meetings;
DROP POLICY IF EXISTS "Agents insert own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Agents update own meetings" ON public.meetings;
DROP POLICY IF EXISTS "Agents delete own meetings" ON public.meetings;

CREATE POLICY "Agents read own meetings"
  ON public.meetings FOR SELECT
  USING (agent_id = auth.uid());

CREATE POLICY "Agents insert own meetings"
  ON public.meetings FOR INSERT
  WITH CHECK (agent_id = auth.uid());

CREATE POLICY "Agents update own meetings"
  ON public.meetings FOR UPDATE
  USING       (agent_id = auth.uid())
  WITH CHECK  (agent_id = auth.uid());

CREATE POLICY "Agents delete own meetings"
  ON public.meetings FOR DELETE
  USING (agent_id = auth.uid());
