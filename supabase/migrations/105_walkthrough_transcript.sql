-- 105_walkthrough_transcript.sql
-- The conversation in the room, kept as text and nothing else.
--
-- WHAT THIS IS FOR:
--
-- Maxwell stands in a kitchen talking to a seller for ten minutes. Half of what
-- matters is said out loud and never written down, because writing it down
-- means stopping the conversation. This holds what was said, tagged with the
-- room he was standing in, so that afterwards it can be turned into the
-- deficiency list he would otherwise have rebuilt from memory at a keyboard.
--
-- NO AUDIO IS EVER STORED. The browser's speech engine returns text; the audio
-- never reaches this application and is never written anywhere. What is kept is
-- a transcript, and that is deliberate: a stored recording of a client is a
-- materially larger privacy obligation than a stored note, and the note is all
-- that is actually needed.
--
-- THE TRANSCRIPT IS PRIVATE. It sits beside agent_notes, not beside summary.
-- The token functions in migrations 101 and 104 select named columns and never
-- select these, so nothing here can reach the seller's review page. What the
-- seller sees is only what Maxwell promotes out of it into a deficiency or the
-- summary, after he has read it.
--
-- CONSENT IS RECORDED, NOT ASSUMED.
--
-- Section 184(2) of the Criminal Code makes it lawful for a participant to
-- record their own conversation, so the one-party rule covers Maxwell. It does
-- not cover PIPEDA. Collecting a client's spoken words in the course of
-- commercial activity is a collection of personal information, so the seller
-- must be told it is happening, told what it is for, and must agree. The app
-- therefore will not start listening until consent is affirmed, and these two
-- columns are where that fact lives afterwards. The activity_log entry written
-- at the same moment is the durable record.
--
-- Run in the Supabase SQL Editor, after 101 and 104. Safe to re-run.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The transcript
-- ══════════════════════════════════════════════════════════════════════════
-- An array of {area, text, at} rather than one block of prose, because the
-- room he was standing in is half the meaning of what he said. "That will need
-- replacing" is worth nothing without it.

alter table public.walkthroughs
  add column if not exists transcript jsonb not null default '[]'::jsonb;

-- Set when the transcript has been turned into proposed notes, so the work is
-- not silently redone and he can see that a session has already been processed.
alter table public.walkthroughs
  add column if not exists transcript_processed_at timestamptz;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Consent
-- ══════════════════════════════════════════════════════════════════════════
-- Nulls mean no recording has ever been consented to on this walkthrough, and
-- the app treats that as a hard stop rather than as a default.

alter table public.walkthroughs
  add column if not exists recording_consent_at timestamptz;

-- Who agreed and how it was put to them, in Maxwell's words, e.g.
-- "Told Rosalind the phone would take notes of what we discussed so I could
--  write it up, and that no audio is kept. She said go ahead."
alter table public.walkthroughs
  add column if not exists recording_consent_note text;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Nothing here reaches the seller
-- ══════════════════════════════════════════════════════════════════════════
-- No policy changes are needed: the walkthroughs_own policy from migration 101
-- already scopes every column on this table to the owning agent, and the three
-- SECURITY DEFINER token functions select named columns rather than *, so a new
-- column is not exposed by adding it. This block only proves it, and will fail
-- loudly if a future edit to those functions ever starts returning transcript.

do $$
declare
  v_src text;
begin
  select string_agg(pg_get_functiondef(p.oid), E'\n')
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('resolve_walkthrough_token',
                      'walkthrough_rooms_for_token',
                      'walkthrough_defects_for_token');

  if v_src is not null and (v_src ~* '\mtranscript\M' or v_src ~* '\magent_notes\M') then
    raise exception
      'A walkthrough token function now returns transcript or agent_notes. Those are private to the agent and must never reach the seller review page.';
  end if;
end $$;
