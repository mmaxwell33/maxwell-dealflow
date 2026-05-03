-- Maxwell DealFlow — Stakeholder lifecycle support (Phase 3 Lifecycle Complete)
--
-- Adds:
--   • last_nudged_at on deal_stakeholders → so daily-automation can send
--     exactly ONE T+48h reminder per stakeholder (idempotency).
--   • Auto-stage advance trigger on pipeline → pipeline.stage promotes
--     automatically as milestone dates pass, so it always reflects reality.

-- 1. last_nudged_at column for one-time T+48h nudges
ALTER TABLE deal_stakeholders
  ADD COLUMN IF NOT EXISTS last_nudged_at timestamptz;

-- 2. Auto-stage advance trigger
-- Whenever a pipeline row is updated, recompute its stage from the milestone
-- dates. Locked stages (Closed, Fell Through, Withdrawn) are never overwritten.
CREATE OR REPLACE FUNCTION public.pipeline_auto_advance_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := current_date;
  v_old_stage text;
  v_new_stage text;
BEGIN
  v_old_stage := COALESCE(NEW.stage, '');

  -- Locked stages — never auto-overwrite
  IF v_old_stage IN ('Closed', 'Fell Through', 'Withdrawn') THEN
    RETURN NEW;
  END IF;

  -- Compute the most-advanced stage based on which dates have passed
  v_new_stage := v_old_stage;

  -- Acceptance passed → at least 'Accepted'
  IF NEW.acceptance_date IS NOT NULL AND NEW.acceptance_date <= v_today THEN
    IF v_new_stage IN ('', 'Searching', 'Viewings', 'Offers') THEN
      v_new_stage := 'Accepted';
    END IF;
  END IF;

  -- Financing passed → 'Under Contract'
  IF NEW.financing_date IS NOT NULL AND NEW.financing_date <= v_today THEN
    IF v_new_stage IN ('', 'Searching', 'Viewings', 'Offers', 'Accepted') THEN
      v_new_stage := 'Under Contract';
    END IF;
  END IF;

  -- Inspection done (or skipped) AND financing passed → 'Conditions'
  IF (NEW.inspection_date IS NOT NULL AND NEW.inspection_date <= v_today)
     OR coalesce(NEW.inspection_skipped, false) THEN
    IF v_new_stage IN ('Accepted', 'Under Contract') THEN
      v_new_stage := 'Conditions';
    END IF;
  END IF;

  -- Walkthrough passed → 'Walkthrough'
  IF (NEW.walkthrough_date IS NOT NULL AND NEW.walkthrough_date <= v_today)
     OR coalesce(NEW.walkthrough_skipped, false) THEN
    IF v_new_stage IN ('Accepted', 'Under Contract', 'Conditions') THEN
      v_new_stage := 'Walkthrough';
    END IF;
  END IF;

  -- Closing date in the past → 'Closing' (NOT 'Closed' — that requires manual mark)
  IF NEW.closing_date IS NOT NULL AND NEW.closing_date <= v_today THEN
    IF v_new_stage IN ('Accepted', 'Under Contract', 'Conditions', 'Walkthrough') THEN
      v_new_stage := 'Closing';
    END IF;
  END IF;

  IF v_new_stage <> v_old_stage THEN
    NEW.stage := v_new_stage;
    NEW.stage_updated_at := now();
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS pipeline_auto_advance_trg ON pipeline;
CREATE TRIGGER pipeline_auto_advance_trg
  BEFORE INSERT OR UPDATE OF acceptance_date, financing_date, inspection_date,
                              walkthrough_date, closing_date, inspection_skipped,
                              walkthrough_skipped
  ON pipeline
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_auto_advance_stage();
