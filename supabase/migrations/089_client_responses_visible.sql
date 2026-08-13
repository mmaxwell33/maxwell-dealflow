-- 089_client_responses_visible.sql
-- MAKE CLIENT RESPONSES REACH MAXWELL.
--
-- The bug (boardroom session 10, found by Timothy, verified against the code):
-- respond.html writes every client decision into viewing_responses, but NOTHING
-- reads that table. The only three references in the whole app are an insert
-- (js/viewings.js), an expire (same file) and a delete (js/clients.js). Meanwhile
-- the "Client Responses" screen reads client_responses, a legacy table nothing
-- has ever written to, so it is permanently empty and its badge can never fire.
--
-- Consequence: pending_offers is written ONLY on 'make_offer', so the other two
-- answers a client can give -- "keep searching" and "not a fit" -- reached Maxwell
-- NEVER. Not on failure. Always. Every not-a-fit reason a client ever typed is
-- sitting in a table no screen displays.
--
-- js/responses.js now reads viewing_responses instead. It needs one column: a
-- place to record that Maxwell has seen and dealt with a response, so the badge
-- can clear. Everything else it needs already exists (migrations 015 and 016).
--
-- Run in the Supabase SQL Editor. Safe to re-run.

alter table public.viewing_responses
  add column if not exists agent_status text not null default 'new';

-- new = client answered, Maxwell has not opened it
-- reviewed = Maxwell opened it (set automatically when he reads the detail)
-- actioned = Maxwell explicitly marked it handled
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'viewing_responses_agent_status_chk') then
    alter table public.viewing_responses
      add constraint viewing_responses_agent_status_chk
      check (agent_status in ('new','reviewed','actioned'));
  end if;
end $$;

-- The Responses screen lists answered rows newest-first and counts the unread.
create index if not exists viewing_responses_answered_idx
  on public.viewing_responses (agent_id, agent_status, responded_at desc)
  where responded_at is not null;

-- Rows that predate this migration and were already answered are genuinely
-- unread -- Maxwell has never seen any of them, because no screen displayed
-- them. Leaving them 'new' is correct and is the point: the backlog becomes
-- visible the moment the screen is pointed at the right table.
--
-- NOTE: the legacy public.client_responses table is deliberately NOT dropped.
-- js/clients.js still deletes from it in the client-delete cascade, and dropping
-- a table is the one unrecoverable move available here.
