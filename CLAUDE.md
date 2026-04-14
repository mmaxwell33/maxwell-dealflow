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

clients, viewings, viewing_responses, offers, pipeline, checklist_items,
commissions, reports, activity_log, approval_queue, push_subscriptions,
pending_offers, agents, intake_responses, client_responses, new_builds,
form_responses, pipeline_tasks

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
