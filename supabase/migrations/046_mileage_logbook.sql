-- ─────────────────────────────────────────────────────────────────────────────
-- 046_mileage_logbook.sql
-- Mileage logbook for CRA vehicle-expense tax compliance.
-- Adds mileage_trips table + 5 settings columns on agents.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── New table: mileage_trips ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mileage_trips (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  trip_date           DATE NOT NULL,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  start_address       TEXT,
  start_lat           NUMERIC(10, 7),
  start_lng           NUMERIC(10, 7),
  end_address         TEXT NOT NULL,
  end_lat             NUMERIC(10, 7),
  end_lng             NUMERIC(10, 7),
  distance_km         NUMERIC(8, 2) NOT NULL DEFAULT 0,
  is_round_trip       BOOLEAN NOT NULL DEFAULT TRUE,
  purpose             TEXT NOT NULL DEFAULT 'Viewing',
  linked_viewing_id   UUID REFERENCES public.viewings(id) ON DELETE SET NULL,
  linked_pipeline_id  UUID REFERENCES public.pipeline(id) ON DELETE SET NULL,
  client_id           UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name         TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mileage_trips_agent_date_idx
  ON public.mileage_trips (agent_id, trip_date DESC);

CREATE INDEX IF NOT EXISTS mileage_trips_viewing_idx
  ON public.mileage_trips (linked_viewing_id)
  WHERE linked_viewing_id IS NOT NULL;

-- ── Row Level Security: agents see/edit only their own rows ─────────────────
ALTER TABLE public.mileage_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents read own mileage"   ON public.mileage_trips;
DROP POLICY IF EXISTS "Agents insert own mileage" ON public.mileage_trips;
DROP POLICY IF EXISTS "Agents update own mileage" ON public.mileage_trips;
DROP POLICY IF EXISTS "Agents delete own mileage" ON public.mileage_trips;

CREATE POLICY "Agents read own mileage"
  ON public.mileage_trips FOR SELECT TO authenticated
  USING (agent_id = auth.uid());

CREATE POLICY "Agents insert own mileage"
  ON public.mileage_trips FOR INSERT TO authenticated
  WITH CHECK (agent_id = auth.uid());

CREATE POLICY "Agents update own mileage"
  ON public.mileage_trips FOR UPDATE TO authenticated
  USING       (agent_id = auth.uid())
  WITH CHECK  (agent_id = auth.uid());

CREATE POLICY "Agents delete own mileage"
  ON public.mileage_trips FOR DELETE TO authenticated
  USING (agent_id = auth.uid());

-- ── Settings columns on agents ───────────────────────────────────────────────
-- home_base_address       : default origin for non-viewing trips (e.g. eXp office)
-- home_base_lat / lng     : geocoded once, cached for distance calculations
-- per_km_rate             : CRA 2026 first-tier rate is $0.73/km; agent can edit
-- mileage_prompts_enabled : controls Phase-2 auto-push at viewing time
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS home_base_address       TEXT,
  ADD COLUMN IF NOT EXISTS home_base_lat           NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS home_base_lng           NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS per_km_rate             NUMERIC(5, 3) NOT NULL DEFAULT 0.730,
  ADD COLUMN IF NOT EXISTS mileage_prompts_enabled BOOLEAN       NOT NULL DEFAULT TRUE;

-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_mileage_trips_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mileage_trips_updated_at ON public.mileage_trips;
CREATE TRIGGER mileage_trips_updated_at
  BEFORE UPDATE ON public.mileage_trips
  FOR EACH ROW EXECUTE FUNCTION public.set_mileage_trips_updated_at();
