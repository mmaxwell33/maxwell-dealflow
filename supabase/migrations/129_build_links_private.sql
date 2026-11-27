-- ─────────────────────────────────────────────────────────────────────────────
-- 129_build_links_private.sql
-- Stops the public listing of new-build portal links and builds.
--
-- RUN ONLY AFTER build.html loads through build_token_load (migration 128 plus
-- the build.html change are live on maxwell-dealflow.vercel.app). Run before
-- that and buyers' build pages show "link not valid".
--
-- build_tokens_anon_select (USING true) let anyone holding the public key list
-- every build portal link; new_builds_anon_token_select let them list every
-- build that has a live link. Every portal now loads through SECURITY DEFINER
-- functions (build_token_load, client_load_build, builder_load, ...), which do
-- not need these rules. The owning agent keeps full access through
-- build_tokens_agent_own and new_builds_own.
--
-- db push is broken on this project: run this in the Supabase SQL Editor, or
--   supabase db query --linked -f supabase/migrations/129_build_links_private.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "build_tokens_anon_select" ON public.build_tokens;
DROP POLICY IF EXISTS "new_builds_anon_token_select" ON public.new_builds;

-- DOWN (re-opens the gap; only if a build page breaks):
-- CREATE POLICY "build_tokens_anon_select" ON public.build_tokens FOR SELECT USING (true);
-- CREATE POLICY "new_builds_anon_token_select" ON public.new_builds FOR SELECT
--   USING (has_active_build_token(id) OR (builder_token IS NOT NULL AND builder_token_expires > now()));
