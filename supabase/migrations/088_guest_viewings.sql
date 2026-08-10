-- 088_guest_viewings.sql
-- GUEST VIEWINGS — book a showing for someone who is not on the roster yet.
--
-- The problem: viewings.client_id is required (and every downstream feature —
-- confirmation email, respond.html feedback token, offers, pipeline — is keyed
-- off it). So "book a viewing for a friend who isn't in my system" had no path
-- at all: you either added them as a full client first, or you didn't book.
--
-- The fix, deliberately NOT a nullable client_id: a guest IS a clients row from
-- the moment you book, just flagged is_guest = true. That means the whole
-- viewing machinery works unchanged for them, and "promote to client" is a
-- single flag flip instead of a data migration. Guests are filtered out of the
-- Clients roster (their own "Guest" chip), out of Broadcast, and out of the
-- automated re-engagement nudges until they are promoted.
--
-- Run in Supabase SQL Editor (db push is out of sync — see project notes).

alter table public.clients
  add column if not exists is_guest    boolean not null default false,
  add column if not exists guest_since timestamptz,
  add column if not exists promoted_at timestamptz;

comment on column public.clients.is_guest IS
  'True while this person is only a viewing guest, not a roster client. Hidden from the Clients stage list, Broadcast and re-engagement emails. Cleared by Clients.promoteGuest().';
comment on column public.clients.guest_since IS
  'When the row was created as a viewing guest.';
comment on column public.clients.promoted_at IS
  'When the guest was promoted to a full client (null if never a guest, or still a guest).';

-- The Clients list, Broadcast and re-engagement all filter on (agent_id, is_guest).
create index if not exists clients_is_guest_idx on public.clients (agent_id, is_guest);

-- Existing rows are all real clients — the DEFAULT above already set them
-- false. Nothing to backfill.
--
-- CASL note: a guest gets the transactional viewing confirmation and feedback
-- link for the showing they personally asked for, and nothing else. Guest rows
-- are written with email_consent = 'none' so the Broadcast tool (which filters
-- on express / unexpired implied consent) can never include them. Promotion
-- moves them to 'implied' with its own consent_at stamp.
