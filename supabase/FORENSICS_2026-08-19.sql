-- ═══════════════════════════════════════════════════════════════════════════
-- FORENSICS — 2026-08-19 · Boardroom Session 11
-- ═══════════════════════════════════════════════════════════════════════════
-- READ ONLY. Every statement here is a SELECT. Nothing is inserted, updated,
-- deleted or altered. It is safe to run on production, safe to re-run, and
-- safe to stop halfway.
--
-- WHY THIS EXISTS. Two board members independently reached the same
-- conclusion: almost every finding in this session is INFERRED FROM SOURCE
-- FILES, because nobody can prove which migrations are actually applied.
-- `supabase db push` is broken, migrations are pasted by hand, there is a
-- duplicate 060, and `submit_intake` has eight definitions across seven files.
-- Two of the answers below can invert the whole priority list.
--
-- Paste the whole thing, run it, and send back the results.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Q1 · WHAT IS ACTUALLY RUNNING RIGHT NOW ────────────────────────────────
-- The single most useful query here. It reads the live body of the four public
-- functions and reports what each one contains.
--
-- joins_auth_users must be TRUE for all four. FALSE means that function can
-- still hand a client's submission to an account nobody can sign into, which
-- is what happened on 2026-08-19.
-- has_095_lookup TRUE on submit_intake proves migration 095 is applied.
-- has_broker_block TRUE proves the lender routing that 087 dropped is restored.

select p.proname                                    as function_name,
       (p.prosrc like '%auth.users%')               as joins_auth_users,
       (p.prosrc like '%lookup_surname%')           as has_095_lookup,
       (p.prosrc like '%broker_referral_requests%') as has_broker_block,
       md5(p.prosrc)                                as body_fingerprint
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('submit_intake', 'get_public_agent_profile',
                    'dealflow_founder_id', 'lookup_returning_client')
order by 1;


-- ── Q2 · THE PUBLIC CONSENT NAME ───────────────────────────────────────────
-- This is the agent whose name and contact details appear on the public intake
-- form, inside the sentence the client consents to. If it returns anything
-- other than the eXp Realty account, clients have been consenting to
-- collection by an identity that cannot receive mail. That is a live privacy
-- defect on a public page and it outranks everything else in the session.

select * from public.get_public_agent_profile(null);


-- ── Q3 · THE SECOND STRANDING PATH, POSSIBLY STILL ARMED ───────────────────
-- Migration 060 set a permanent DEFAULT on client_intake.agent_id, choosing the
-- founder with ORDER BY created_at NULLS FIRST — which actively PREFERS a row
-- with no created_at, exactly what a hand-inserted orphan looks like. The only
-- DROP DEFAULT statements in the repo are in migrations 041 and 042, both of
-- which run BEFORE 060. So nothing has ever removed it.
--
-- default_is_set TRUE with points_at_dead_account TRUE means a second way to
-- strand a client's submission is still live today, and no fix proposed this
-- session touches it.

select c.column_default,
       (c.column_default is not null) as default_is_set,
       exists (
         select 1
         from public.agents a
         left join auth.users u on u.id = a.id
         where u.id is null
           and c.column_default like '%' || a.id::text || '%'
       ) as points_at_dead_account
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name  = 'client_intake'
  and c.column_name = 'agent_id';


-- ── Q4 · IS ANYTHING UNREACHABLE RIGHT NOW ─────────────────────────────────
-- A row whose agent_id has no login cannot be read by anyone, including
-- Maxwell. Every count must be 0. Any non-zero number is live client data
-- currently invisible in the app.

select 'client_intake'            as table_name, count(*) as unreachable_rows
  from public.client_intake x left join auth.users u on u.id = x.agent_id where u.id is null
union all
select 'clients',                 count(*) from public.clients x
  left join auth.users u on u.id = x.agent_id where u.id is null
union all
select 'broker_referral_requests', count(*) from public.broker_referral_requests x
  left join auth.users u on u.id = x.agent_id where u.id is null
union all
select 'commissions',             count(*) from public.commissions x
  left join auth.users u on u.id = x.agent_id where u.id is null
union all
select 'offers',                  count(*) from public.offers x
  left join auth.users u on u.id = x.agent_id where u.id is null
order by 1;


-- ── Q5 · HOW MANY SUBMISSIONS WERE ACTUALLY LOST ───────────────────────────
-- The recovery on 2026-08-19 overwrote agent_id in place, so the obvious query
-- can no longer answer this. But Postgres stamps every row with the id of the
-- transaction that last wrote it (xmin), and the repair function was created in
-- the same transaction as the repair itself. So the rows that were swept still
-- carry that transaction's fingerprint.
--
-- Take paste_txid from the first query, find the matching txid in the second.
-- rows_written on that line is EXACTLY how many submissions had been stranded.

select p.proname, p.xmin::text::bigint as paste_txid
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'dealflow_founder_id';

select ci.xmin::text::bigint                        as txid,
       count(*)                                     as rows_written,
       min(ci.submitted_at)                         as earliest,
       max(ci.submitted_at)                         as latest,
       count(*) filter (where ci.status = 'New')    as still_unactioned
from public.client_intake ci
group by 1
order by 1 desc;


-- ── Q6 · IS THE AUTOMATION ALIVE ───────────────────────────────────────────
-- Deadline reminders, financing alerts, closing-day emails and the morning
-- briefing all depend on scheduled jobs. vercel.json has no cron entries at
-- all, so scheduling rests entirely on pg_cron blocks that were pasted by hand
-- and never confirmed. If this returns nothing, none of that has ever run.

select jobid, jobname, schedule, active from cron.job order by jobname;

select j.jobname, d.status, d.start_time, left(coalesce(d.return_message,''), 80) as message
from cron.job_run_details d
join cron.job j using (jobid)
order by d.start_time desc
limit 20;


-- ── Q7 · IS CLIENT MAIL PILING UP UNSENT ───────────────────────────────────
-- Nothing on the server sends queued client email. Approvals.approve() runs in
-- the browser, so a message sends only when Maxwell opens the app and taps it.
-- Pending rows more than a few days old are clients who were promised
-- something and never heard back.

select status, count(*) as n, min(created_at) as oldest
from public.approval_queue
group by status
order by n desc;

select approval_type, client_name, email_subject, created_at,
       (now() - created_at) as waiting_for
from public.approval_queue
where status = 'Pending' and created_at < now() - interval '3 days'
order by created_at
limit 25;


-- ═══════════════════════════════════════════════════════════════════════════
-- Send the results back. Q1, Q2 and Q3 are the ones that can change what gets
-- fixed first. Nothing here has modified anything.
-- ═══════════════════════════════════════════════════════════════════════════
