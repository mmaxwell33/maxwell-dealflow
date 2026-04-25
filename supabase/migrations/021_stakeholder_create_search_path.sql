-- 021_stakeholder_create_search_path.sql
--
-- Fix: stakeholder_create() was failing with
--   "function gen_random_bytes(integer) does not exist"
-- because migration 007 (security RLS hardening) locked the function's
-- search_path to "public, pg_temp" — which excluded the `extensions`
-- schema where pgcrypto (and gen_random_bytes) lives.
--
-- This migration adds `extensions` to the function's search_path only,
-- keeping the rest of the security hardening intact.
--
-- Verified live on 2026-04-24: portal token generation works after this
-- ALTER and proconfig now reads:
--   ["search_path=public, extensions, pg_temp"]

alter function public.stakeholder_create(
  p_pipeline_id uuid,
  p_client_id   uuid,
  p_agent_id    uuid,
  p_role        text,
  p_name        text,
  p_email       text,
  p_phone       text,
  p_notes       text
) set search_path = public, extensions, pg_temp;
