-- ─────────────────────────────────────────────────────────────────────────────
-- 124_intake_also_copy.sql
-- "Also copy on every email" (a sister, a parent) on an intake Maxwell has not
-- accepted yet. Set from Form Responses, Edit. On Add as Client it becomes a
-- client_contacts row with role 'family_copy', and from then on every email TO
-- that client copies this person (Approvals._finalize). Additive; the existing
-- client_intake RLS covers it. Not asked on the public form.
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/124_intake_also_copy.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS copy_name  text;
ALTER TABLE public.client_intake ADD COLUMN IF NOT EXISTS copy_email text;

-- DOWN:
-- ALTER TABLE public.client_intake DROP COLUMN IF EXISTS copy_name;
-- ALTER TABLE public.client_intake DROP COLUMN IF EXISTS copy_email;
