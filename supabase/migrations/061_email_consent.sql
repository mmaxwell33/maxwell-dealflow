-- 061_email_consent.sql
-- CASL: record email consent on clients so the Broadcast tool can exclude
-- anyone we're not allowed to bulk-email. Broadcast reads public.clients, so
-- the consent model lives here.
--
-- Note: website contact-form leads land in client_intake (the Form Responses
-- tab), NOT in clients, so they are never Broadcast targets until you convert
-- them into a client. This gate therefore covers the converted / manually
-- added clients that Broadcast actually emails.
--
-- Chair-approved default (2026-07-15): existing contacts are treated as
-- IMPLIED consent from an existing business relationship, with a rolling
-- 2-year window. New client rows inherit the same defaults. You can mark an
-- individual client 'express' (opted in) or 'none' (do not email) anytime.

alter table public.clients
  add column if not exists email_consent      text        not null default 'implied',
  add column if not exists consent_source     text        default 'existing relationship',
  add column if not exists consent_at          timestamptz default now(),
  add column if not exists consent_expires_at  timestamptz default (now() + interval '2 years');

-- Restrict the column to known values.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_email_consent_chk') then
    alter table public.clients
      add constraint clients_email_consent_chk
      check (email_consent in ('express','implied','none'));
  end if;
end $$;

-- Backfill provenance for rows that predate this migration (the ALTER above
-- already set implied + timestamps via the column defaults; this just labels
-- the source honestly).
update public.clients
   set consent_source = coalesce(consent_source, 'existing relationship (migration 061 backfill)')
 where consent_source is null;
