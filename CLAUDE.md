# Maxwell DealFlow CRM — Claude Instructions

## SURGICAL UPDATE MODE — MANDATORY

This is a working, production PWA. Real clients and real agent data depend on it.
**Never rewrite files. Never touch code that is not directly related to the requested change.**

### The 5 Rules — no exceptions:

1. **Read before editing.** Always use Grep or Read to find the exact lines before making any change.
2. **One function at a time.** Change only the specific function, block, or lines that need updating. Leave everything else exactly as it is.
3. **Show the diff first.** For any non-trivial change, show BEFORE / AFTER so the changes are visible before applying.
4. **Web-search before implementing new features.** Check current best practices and the latest standard APIs before writing new code.
5. **Verify before committing.** Run a syntax check or grep on changed files before staging.

### Commit format:
```
git add [only the specific files changed]
git commit -m "fix/feat/chore: [what changed and why]"
git push origin master
```

---

## Agent / Brokerage Facts

**Brokerage:** Maxwell's brokerage is **eXp Realty** (NOT Royal LePage). All email templates must sign off as eXp Realty.

## Project Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Vanilla JS PWA (no framework) | Fast, offline-capable, installable on iPhone |
| Hosting | Vercel (auto-deploys from GitHub master) | Zero-config, instant global CDN |
| Database | Supabase (PostgreSQL + RLS) | Real-time, auth, storage, edge functions |
| Email | Supabase Edge Function → Gmail API | Sends from Maxwell's real Gmail account |
| Push Notifications | Web Push / VAPID (P-256 / JWK) | Background push to phone even when app is closed |
| AI Assistant | Claude API (claude-haiku) | In-app Ask AI feature |

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Main app shell — all screens and modals |
| `css/app.css` | All styles — uses CSS variables in :root |
| `js/app.js` | Core: auth, routing, helpers (fmtDate, fmtMoney, pushNotify) |
| `js/clients.js` | Client list, archive, privacy masking |
| `js/viewings.js` | Booking, auto-completion, agent feedback modal |
| `js/offers.js` | Offers, Pipeline, Transaction Room, PDF export, Requests tab |
| `js/notifications.js` | All email templates + Notify.queue() + daily automation |
| `js/extras.js` | Approvals, Email Send, Broadcast, Settings, System Health |
| `js/analytics.js` | Charts — uses Chart.js |
| `js/calendar.js` | Calendar view |
| `respond.html` | Standalone client response page (no login) |
| `portal.html` | Standalone client deal progress page (no login) |
| `intake.html` | Client intake form |
| `config.js` | Supabase URL, anon key, VAPID public key |
| `sw.js` | Service worker — Web Push + offline cache |
| `supabase/functions/send-push/` | VAPID Web Push edge function (Deno, JWK key format) |
| `supabase/functions/send-email/` | Gmail send edge function |

## Database Tables (Supabase)

Core CRM: agents, clients, client_intake (intake form submissions — NOT "intake_responses"),
client_contacts, client_documents, client_reviews
Deals: viewings, viewing_responses, offers, pending_offers, pipeline, deal_checklist
(the per-deal checklist — NOT "checklist_items", which is Maxwell's personal to-do list),
deal_documents, deal_stakeholders, listings, listing_offers, new_builds, commissions,
disclosures, pipeline_reschedules
Communications: approval_queue, email_inbox, briefings, broker_referral_requests
Portals/tokens: build_tokens, builder_visit_requests, portal_views
Ops: activity_log, push_subscriptions, mileage_trips, meetings, client_errors,
email_rate_limit, claude_rate_limit

Gotchas (boardroom audit Jul 2026): `viewings` has NO agent_id — scoped via
client_id/RLS. `client_responses` is read by the Responses screen but nothing
writes to it (legacy). "reports", "form_responses", "pipeline_tasks" do not
exist in code — do not reference them. Pipeline has BOTH financing_date/
inspection_date AND financing_deadline/inspection_deadline — always write both
pairs (see migration 063).

## CSS Theme Variables (:root)

```css
--bg       → main background (dark navy)
--card     → card/surface color
--accent   → primary accent (indigo #5b5bd6)
--accent2  → lighter accent (#7c7cff)
--text1    → primary text
--text2    → secondary/muted text
--green    → success
--red      → danger
--yellow   → warning
```
Light mode is toggled via `body.theme-light`.

## Known Patterns

- **Privacy masking**: `App.privateName()`, `App.privateContact()` — click to reveal
- **Email flow**: `Notify.queue()` → approval_queue → `Approvals.approve()` → send-email edge fn
- **Auto-approve**: Notifications with auto-approve enabled skip the queue and call `Approvals.approve()` directly
- **Web Push**: `App.subscribePush()` registers device → `App.sendWebPush()` calls send-push edge fn
- **Respond page**: Uses VAPID tokens stored in viewing_responses — no auth required for client
- **Date formatting**: Always use `App.fmtDate(d)` — handles both plain YYYY-MM-DD and full timestamptz from Supabase

## Git Workflow

The sandbox cannot push to GitHub directly (network egress restriction).
Always prepare the commit in the sandbox, then have the user run:
```bash
cd ~/Desktop/maxwell-dealflow && rm -f .git/HEAD.lock .git/index.lock && git pull && git push
```

### Preview-gated changes (broker.html, or anything Maxwell wants to see live before it ships)

Default (above) pushes straight to `master`, which Vercel deploys to
production instantly. For **broker.html** and anything else Maxwell wants to
test before it goes live, use a feature branch instead — Vercel already
auto-builds a Preview Deployment for any pushed branch (Boardroom, 2026-07-22
— this repo already has dozens of feature branches doing this; no vercel.json
change needed):

```bash
cd ~/Desktop/maxwell-dealflow && git checkout -b feat/<branch-name>
# ...commit the change...
git push origin feat/<branch-name>
```
Have the user push the **branch**, not `master`. Vercel builds a preview URL
automatically (visible in the Vercel dashboard, or the check on the GitHub
commit). Only after Maxwell approves on that preview URL:
```bash
git checkout master && git merge feat/<branch-name> && git push origin master
```
