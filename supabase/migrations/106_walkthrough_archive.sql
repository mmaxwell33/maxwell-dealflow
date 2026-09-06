-- 106_walkthrough_archive.sql
-- Putting a walkthrough away without destroying it.
--
-- WHY ARCHIVE EXISTS ALONGSIDE DELETE:
--
-- Two different things get confused here. A walkthrough started at the wrong
-- address, or a test row, is a MISTAKE and should be deleted outright: it is
-- not a record of anything. A walkthrough of a house whose owner then decided
-- not to list is not a mistake. It is a dated account of the condition of a
-- property, taken by a licensed agent, and it is exactly the thing that matters
-- eighteen months later when they call back, or when somebody asks what was
-- disclosed and when.
--
-- So the list gets a way to put the second kind out of sight that does not
-- reach for the first kind's button.
--
-- A certified walkthrough can be archived and can never be deleted. That rule
-- lives in the app rather than here, because a delete of a whole row is not
-- something a check constraint can catch usefully, but it is worth writing down
-- where the column is defined.
--
-- Run in the Supabase SQL Editor, after 101, 104 and 105. Safe to re-run.

alter table public.walkthroughs
  add column if not exists archived_at timestamptz;

-- Why it was put away, in Maxwell's words: "Decided to wait until spring",
-- "Went with another agent". The reason is the part worth having later.
alter table public.walkthroughs
  add column if not exists archived_reason text;

-- The list reads active rows constantly and archived rows almost never.
create index if not exists walkthroughs_active_idx
  on public.walkthroughs(agent_id, created_at desc)
  where archived_at is null;
