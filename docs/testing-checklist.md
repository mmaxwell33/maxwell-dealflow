# E. Testing Checklist — Maxwell DealFlow CRM Migration

Each section covers: **what to test**, **manual steps**, **edge cases**, **expected result**, and **rollback notes**.

---

## 0. Pre-flight: Run the DB migration

**Before testing anything**, apply both migrations in the Supabase SQL editor in order:

1. `supabase/migrations/001_phase1_schema.sql`
2. `supabase/migrations/002_cron_schedule.sql` (after enabling pg_cron + pg_net extensions)

Verify with:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline';
-- Should include: walkthrough_date, status, client_id, client_email, offer_id, stage_updated_at

SELECT column_name FROM information_schema.columns WHERE table_name = 'deal_checklist';
-- Should return all columns from the CREATE TABLE statement

SELECT jobname, schedule FROM cron.job WHERE jobname = 'maxwell-daily-automation';
-- Should return one row
```

---

## 1. Email Templates — New Templates in Approval Queue

### 1.1 Walkthrough Reminder (queued by client-side login check)

**Steps:**
1. Create a pipeline deal with `walkthrough_date` = tomorrow's date
2. Log out and log back in to trigger `Notify.checkConditionDeadlines()`
3. Navigate to **Approvals**

**Expected:** An approval card appears — subject `🏠 Reminder: Final Walkthrough Tomorrow — <address>`, approval type `Walkthrough Reminder (1 day)`.

**Edge cases:**
- Walkthrough date = today → no email (function checks `daysLeft === 1`)
- Walkthrough date = 2 days away → no email
- Deal already has a Pending approval of this type from today → dedup guard prevents second insert

**Rollback:** Delete the row from `approval_queue` using the Supabase table editor.

---

### 1.2 Deal Fell Through — Client Encouragement Email

**Steps:**
1. Open a deal in the Pipeline tab that has a linked `client_email`
2. Click the **✕ Fell Through** button on the pipeline card
3. Confirm the dialog
4. Navigate to **Approvals**

**Expected:**
- Pipeline card disappears (or moves to Fell Through stage)
- An approval card appears — subject `We're Still in Your Corner — <address>`, type `Deal Fell Through`
- The linked **client record's stage** resets to `Searching`
- An activity log entry `DEAL_FELL_THROUGH` appears in the activity log

**Edge cases:**
- Deal has no `client_id` / `client_email` → no email queued, no crash (guarded by `if (d?.client_email)`)
- Clicking Fell Through on an already-Fell-Through deal → DB update is idempotent; approval dedup prevents duplicate email

**Rollback:** Update pipeline stage back to `Conditions` or `Accepted`; delete the approval_queue row; update client stage back to `Accepted`.

---

### 1.3 Deal Closed — Happy Closing Day Email + Client Stage

**Steps:**
1. Open a pipeline deal in Closing or Conditions stage
2. Click the **✓ Close Deal** button
3. Navigate to **Approvals** and to the linked **Client** record

**Expected:**
- Approval card appears — subject `🔑 You're a Homeowner! — <address>`, type `Deal Closed`
- Client record stage updated to `Closed`
- Commission entry created (if `record commission` was triggered)

**Edge cases:**
- Deal with no linked client → email still queued using `deal.client_email`; no crash if `client_id` is null

---

### 1.4 Post-Closing Referral (server-side, 7 days after closing)

**Steps (manual simulation):**
1. Find a pipeline deal with `stage = Closed` and `closing_date` = exactly 7 days ago
2. Manually trigger the edge function via Supabase Dashboard → Edge Functions → `daily-automation` → Test (send empty body `{}`)
3. Navigate to **Approvals**

**Expected:** Approval card appears — subject `🏡 How's the New Home? — <address>`, type `Post-Closing Referral Request 🙏`.

**Edge cases:**
- Closing date = 6 days ago → no email yet
- Closing date = 8 days ago → no email (window missed)
- Already sent → dedup guard (same `related_id` + type within 25h) prevents second card

**Rollback:** Delete the row from `approval_queue`.

---

### 1.5 New Listing Match — Manual Send Email Screen

**Steps:**
1. Navigate to **Send Email** (Extras section)
2. Select client from dropdown
3. Choose template **"New Listing Match 🏠"** from the template selector
4. Verify the body auto-fills with a listing-match template
5. Click Send / Queue

**Expected:** Approval card created with the listing match body. Template renders without JS errors.

**Edge cases:**
- No client selected → UI should show a warning, not crash
- Template loads even if no listing data is provided (template uses fallback placeholders)

---

## 2. Pipeline Stage Sync → Clients Table

### 2.1 Manual Stage Update Syncs Client Stage

**Steps:**
1. Open a pipeline deal that has `client_id` set
2. Change the stage dropdown to `Conditions`
3. Open the linked client record

**Expected:** Client `stage` field = `Conditions`.

**Stage map to verify:**
| Pipeline Stage | Client Stage |
|---|---|
| Accepted | Accepted |
| Conditions | Conditions |
| Closing | Closing |
| Closed | Closing (set to `Closed` by `closeDeal()`) |
| Fell Through | Searching (set by `markFellThrough()`) |

**Edge cases:**
- Pipeline deal with no `client_id` → stage update still works, just no client sync (guarded with `if (d?.client_id && clientStage)`)
- Changing back to `Accepted` from `Conditions` → client stage correctly reverts

---

## 3. Deal Checklist

### 3.1 Auto-Generated on Offer Acceptance

**Steps:**
1. Open the **Offers** tab
2. Select an offer that is in `Pending` or `Submitted` status
3. Click **Accept Offer**
4. Navigate to **Pipeline** tab

**Expected:**
- New pipeline card appears with a **☑️ Checklist** button
- Clicking **☑️ Checklist** opens a modal with 22 tasks grouped by category (Legal, Financing, Inspection, Moving, General)
- Progress bar shows 0% complete
- Due dates are calculated relative to today's date (acceptance date)

**Edge cases:**
- `Pipeline.generateChecklist()` fails silently if `deal_checklist` table doesn't exist → run migration 001 first
- Accepting an offer for a client with no email → checklist still generates; email functions skip gracefully
- Accepting the same offer twice → second `createFromOffer()` call creates a duplicate pipeline row (future: add a guard)

**Rollback:** Delete from `deal_checklist` where `pipeline_id = <id>`; delete from `pipeline` where `id = <id>`.

---

### 3.2 Checking Off Tasks

**Steps:**
1. Open the **☑️ Checklist** modal on any pipeline card
2. Click the checkbox next to any task
3. Close and reopen the modal

**Expected:**
- Task shows as checked (strikethrough text, muted color)
- Progress bar increments
- On reopen: state is persisted (checkbox still checked)

**Edge cases:**
- Checking a task while offline → Supabase call fails silently; checkbox appears checked client-side but reverts on next load
- Checking all 22 tasks → progress bar reaches 100%, green colour

---

### 3.3 Regenerate Checklist for Existing Deals

**Steps:**
1. Open the **☑️ Checklist** button on a deal created *before* Phase 2 was deployed
2. Modal should show "No tasks yet — generating..." then populate

**Expected:** `Pipeline.regenerateChecklist()` is called, 22 tasks are inserted, modal refreshes.

**Edge cases:**
- If `closing_date` is missing → due dates fall back to `null` (tasks show no due date, no crash)

---

## 4. Reports — Correct Data by Client ID

### 4.1 Client Report Shows Correct Offers

**Steps:**
1. Open a **Client** record
2. Click **Generate Report**
3. Look at the **Offers** section

**Expected:**
- Only offers where `client_id = <this client's UUID>` appear
- No offers from other clients bleed in (old bug: string-matched by name)
- Offers show `offer_date` and `status` columns (not `stage`)

**Edge cases:**
- Client with zero offers → "No offers yet" or empty table, no crash
- Client with 5 offers → all 5 appear in descending offer date order

---

## 5. Server-Side Daily Automation (Edge Function)

### 5.1 Manual Trigger via Dashboard

**Steps:**
1. In Supabase Dashboard → Edge Functions → `daily-automation`
2. Click **Invoke** (or use the test panel with empty body `{}`)
3. Check the response body

**Expected JSON response:**
```json
{
  "processed": <number of active deals>,
  "queued": <number of new approval emails>,
  "skipped_duplicate": <number skipped>,
  "errors": [],
  "runAt": "<ISO timestamp>"
}
```

**Edge cases:**
- No active deals → `processed: 0`, `queued: 0`, `errors: []`
- Deal with no client email → `errors` array contains `"deal <id>: no client email"`
- `SUPABASE_SERVICE_ROLE_KEY` not set → returns HTTP 500 with error message

### 5.2 Idempotency — Run Twice in Same Day

**Steps:**
1. Trigger the function manually
2. Wait 10 seconds
3. Trigger again

**Expected:** Second run returns `queued: 0`, `skipped_duplicate: <same number as first run's queued>`. No duplicate approval cards in Approvals tab.

### 5.3 Cron Schedule Verification

**Steps (after running migration 002):**
```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'maxwell-daily-automation';
```

**Expected:** One row, `active = true`, `schedule = '0 8 * * *'`.

**To disable temporarily:**
```sql
SELECT cron.unschedule('maxwell-daily-automation');
```

**To re-enable:**
Re-run the `SELECT cron.schedule(...)` block from migration 002.

---

## 6. Stale Deal Alerts

### 6.1 30-Day Stale Detection Logged

**Steps:**
1. Find (or create) a pipeline deal with `stage_updated_at` > 30 days ago
2. Trigger the daily-automation function manually
3. In Supabase → Table Editor → `activity_log`, filter by `activity_type = 'STALE_DEAL_ALERT'`

**Expected:** A new row with `note` = `"Deal "<client_name>" has been in stage "<stage>" for <N> days. Consider following up."`

**Edge cases:**
- Deal stuck 29 days → no alert (threshold is strictly > 30)
- Same deal triggers alert every day if not resolved → by design (no dedup for stale alerts; they're informational only)

---

## 7. End-to-End Client Journey

Run through the complete journey for one test client to verify all pieces connect:

| Step | Action | Verify |
|---|---|---|
| 1 | Add client via **+ New Client** | Client appears in list, stage = Searching |
| 2 | Welcome email auto-queued | Approval card appears in Approvals |
| 3 | Approve + send welcome email | Card disappears; sent count increments |
| 4 | Add a viewing for the client | Viewing card appears |
| 5 | Mark viewing as interested | Follow-up email queued in Approvals |
| 6 | Submit an offer | Offer appears in Offers tab; submission email queued |
| 7 | Accept the offer | Pipeline card created; 22-task checklist auto-generated |
| 8 | Check off 5 tasks | Progress bar = 23% |
| 9 | Update stage to Conditions | Client stage = Conditions |
| 10 | Add walkthrough_date = tomorrow | (login next day) → walkthrough reminder queued |
| 11 | Click Close Deal | Client stage = Closed; closing-day email queued |
| 12 | (7 days later) Trigger automation | Post-closing referral email queued |
| 13 | Generate Report for client | All viewings, offers, pipeline data shown correctly |

---

## 8. Rollback Plan

If any phase introduces a regression:

**Code rollback:**
```bash
# From the worktree
git log --oneline -10
git revert <commit-sha>   # revert specific commit without losing history
```

**DB rollback (drop added columns — ONLY if no live data):**
```sql
-- Example: undo the walkthrough_date column
ALTER TABLE pipeline DROP COLUMN IF EXISTS walkthrough_date;

-- Drop deal_checklist entirely (destructive — back up first)
DROP TABLE IF EXISTS deal_checklist;
```

**Approval queue cleanup:**
```sql
-- Delete all Pending approvals (test data only)
DELETE FROM approval_queue WHERE status = 'Pending' AND created_at > now() - interval '1 day';
```

---

*End of Testing Checklist*
