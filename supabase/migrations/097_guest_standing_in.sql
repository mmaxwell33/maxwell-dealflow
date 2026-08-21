-- 097_guest_standing_in.sql
-- STANDING-IN GUESTS — a guest who attended on a real client's behalf.
--
-- Migration 088 gave a viewing guest exactly one exit: promote them into a
-- client. That is wrong for the common case — a brother or sister walks the
-- property because the actual buyer could not make it. When the offer has to
-- be written, the buyer is the person on the roster, not the guest. Promoting
-- the guest would invent a second client for one deal, and would silently
-- hand them the implied CASL consent of a real client relationship.
--
-- So a guest can instead be LINKED to an existing client. The link says:
-- "this guest stands in for that client". The offer, the pipeline and the
-- stage all belong to the linked client; the guest stays a guest forever
-- (still off the roster, still out of Broadcast and re-engagement), and is
-- only ever copied on the client's mail.
--
-- Run in Supabase SQL Editor (db push is out of sync — see project notes).

alter table public.clients
  add column if not exists linked_client_id  uuid references public.clients(id) on delete set null,
  add column if not exists linked_at         timestamptz,
  add column if not exists link_relationship text,
  add column if not exists cc_on_emails      boolean not null default false;

comment on column public.clients.linked_client_id IS
  'Set on a GUEST row only: the roster client this guest was standing in for. Offers written for the guest are filed against this client instead, and the guest is never promoted. Cleared by Clients.unlinkGuest().';
comment on column public.clients.linked_at IS
  'When the guest was linked to the client they stand in for.';
comment on column public.clients.link_relationship IS
  'Free text describing the standing-in relationship, e.g. "Sister". Shown on the guest card; never emailed.';
comment on column public.clients.cc_on_emails IS
  'Guest rows only: copy this guest on emails addressed to the client they stand in for. Set when the link is made, editable on the card, and overridable per email in Approvals.';

-- The guest card, the client card and Notify.queue all look up
-- "who stands in for this client".
create index if not exists clients_linked_client_idx
  on public.clients (linked_client_id) where linked_client_id is not null;

-- CASL note: nothing here grants the guest consent of their own. They remain
-- email_consent = 'none' and are copied only on transactional mail about the
-- one transaction they are personally handling for the client. Turning
-- cc_on_emails off (or clearing the link) stops it immediately.
