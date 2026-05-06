-- 036_fix_pipeline_auto_advance_trigger.sql
-- Replaces the broken pipeline_auto_advance_stage() function from migration 034.
--
-- Bug in 034: referenced NEW.stage_updated_at which doesn't exist on the
-- pipeline table — caused the BEFORE trigger to silently HANG every INSERT
-- that set financing_date, walkthrough_date, or closing_date. Symptom in JS:
-- db.from('pipeline').insert() Promise stays <pending> forever, no error
-- bubbles up. Disabling the trigger immediately resolved all inserts.
--
-- This fix preserves all auto-advance logic and removes the broken column ref.

DROP TRIGGER IF EXISTS pipeline_auto_advance_trg ON pipeline;
DROP FUNCTION IF EXISTS public.pipeline_auto_advance_stage();

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

  v_new_stage := v_old_stage;

  IF NEW.acceptance_date IS NOT NULL AND NEW.acceptance_date <= v_today THEN
    IF v_new_stage IN ('', 'Searching', 'Viewings', 'Offers') THEN
      v_new_stage := 'Accepted';
    END IF;
  END IF;

  IF NEW.financing_date IS NOT NULL AND NEW.financing_date <= v_today THEN
    IF v_new_stage IN ('', 'Searching', 'Viewings', 'Offers', 'Accepted') THEN
      v_new_stage := 'Under Contract';
    END IF;
  END IF;

  IF (NEW.inspection_date IS NOT NULL AND NEW.inspection_date <= v_today)
     OR coalesce(NEW.inspection_skipped, false) THEN
    IF v_new_stage IN ('Accepted', 'Under Contract') THEN
      v_new_stage := 'Conditions';
    END IF;
  END IF;

  IF (NEW.walkthrough_date IS NOT NULL AND NEW.walkthrough_date <= v_today)
     OR coalesce(NEW.walkthrough_skipped, false) THEN
    IF v_new_stage IN ('Accepted', 'Under Contract', 'Conditions') THEN
      v_new_stage := 'Walkthrough';
    END IF;
  END IF;

  IF NEW.closing_date IS NOT NULL AND NEW.closing_date <= v_today THEN
    IF v_new_stage IN ('Accepted', 'Under Contract', 'Conditions', 'Walkthrough') THEN
      v_new_stage := 'Closing';
    END IF;
  END IF;

  -- Apply only if stage changed.  No reference to stage_updated_at (was the bug).
  IF v_new_stage <> v_old_stage THEN
    NEW.stage := v_new_stage;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER pipeline_auto_advance_trg
  BEFORE INSERT OR UPDATE OF acceptance_date, financing_date, inspection_date,
                              walkthrough_date, closing_date, inspection_skipped,
                              walkthrough_skipped
  ON pipeline
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_auto_advance_stage();
