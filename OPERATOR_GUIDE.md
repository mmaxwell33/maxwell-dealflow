# Maxwell DealFlow — Operator Guide

A complete walkthrough of every feature in the system, written so anyone can pick this up and run the brokerage with it. If you can read English and tap a phone screen, you can operate every part of this app.

---

## 1. What Maxwell DealFlow Is

Maxwell DealFlow is a Progressive Web App (PWA) — meaning it runs in a browser but installs to your iPhone home screen and works offline like a native app. It is the operating system for one real-estate agent's brokerage: tracking clients, booking viewings, sending offers, managing closings, talking to builders, and emailing everyone involved without ever leaving the app.

**Brokerage:** eXp Realty.
**Agent:** Maxwell Delali Midodzi.
**Live URL:** the production deployment served by Vercel from the GitHub `master` branch.

Three things separate this app from an off-the-shelf CRM:

1. **It speaks to clients directly.** Every viewing booking, build update, and stakeholder portal lives at its own public URL. No login required for the recipient — they tap the link in their text or email and the page just works.
2. **It sends real emails from Maxwell's real Gmail.** Through a Supabase Edge Function that signs into Gmail's API, every confirmation, reminder, and update reaches the client's inbox from `maxwell@…`, not from a no-reply address.
3. **It pushes notifications to the phone even when closed.** Web Push (VAPID) wakes the phone the moment a client responds, an offer comes in, or a viewing is confirmed.

---

## 2. Sign In

Open the app URL on your iPhone or laptop. The first screen is a login form.

- **Email + password** logs you into Supabase Auth.
- After successful login the app loads `index.html`, the home dashboard.
- "Add to Home Screen" turns the PWA into a real app icon. Tap it from then on.
- If the page sits idle and the session expires, Supabase will refresh the token automatically. If the refresh fails, you'll be sent back to the login screen.

If you ever lose access, run `supabase auth users update <email> --password <new>` from a machine that has the Supabase CLI signed into the project.

---

## 3. The Dashboard (Overview screen)

This is the first screen after login. It exists to answer one question: **what needs my attention right now?**

Top-of-screen cards show, at a glance:

- **Active clients** — anyone not archived.
- **Viewings today / this week** — count of upcoming bookings.
- **Pipeline value** — sum of `offer_amount` across all live deals.
- **Outstanding tasks** — checklist items not yet ticked off across every deal.
- **Pending approvals** — emails that have been queued by the system but not yet sent.

Below the cards is a feed of recent activity (every action gets logged to the `activity_log` table — see Section 18). Tap any item in the feed to jump to its source screen.

The bell icon (top right) opens the in-app notification tray. Notifications come from two places: Web Push (delivered to the phone) and the in-app feed (visible when the app is open).

The moon icon toggles dark/light mode. The "Ask AI" purple button opens the AI Assistant (Section 17).

---

## 4. Clients

**Where:** Clients tab.
**File:** `js/clients.js`.
**Table:** `clients`.

This is the master list of every buyer or seller Maxwell is working with. Each row shows the client's name, last contact date, and a few quick-action buttons.

**Privacy masking:** client names and contact info are masked by default — you'll see `J••• A•••` instead of `Jane Anderson`. Tap the masked text to reveal it briefly. This is so Maxwell can scroll the list in public without exposing names. The functions powering this are `App.privateName()` and `App.privateContact()` in `js/app.js`.

**Add a client:** tap the `+` button. Fill name, email, phone, status (Active / Archived / Lead), and any notes. Save.

**Archive a client:** swipe-left or use the menu — moves them out of the active view but keeps the history.

**Intake form:** every client gets a public intake link (`intake.html?token=…`). Send it; they fill it; their answers land in the `intake_responses` table and a notification fires on Maxwell's phone.

**Client responses:** anything a client submits (intake form, stakeholder reply, viewing feedback) shows up under the Responses tab on each client's profile, sourced from the `client_responses` and `form_responses` tables.

---

## 5. Viewings (Showings)

**Where:** Viewings tab.
**File:** `js/viewings.js`.
**Tables:** `viewings`, `viewing_responses`.

This is the booking engine for property showings.

**Book a viewing:** tap `+`, pick a client, enter the property address, MLS number, date, time, and duration. Save. Three things happen automatically:

1. A row is inserted into `viewings`.
2. An email is queued (see Section 11) confirming the booking with a calendar invite (.ics) attached.
3. A respond link is generated and embedded in the email — when the client taps it, they land on `respond.html?token=…` (no login needed) and can confirm, reschedule, or cancel.

**Auto-completion:** after a viewing's scheduled end-time passes, it auto-flips to "completed" status the next time the app opens. Maxwell is then prompted with the **Agent Feedback Modal** to log how the showing went — the client's reaction, follow-up notes, and a 1–5 score. This goes back into the client's history.

**Viewing responses:** when a client clicks the respond link, their answer (Yes / Reschedule / Cancel) inserts into `viewing_responses` and triggers a Web Push to Maxwell's phone.

---

## 6. Offers

**Where:** Offers tab.
**File:** `js/offers.js`.
**Tables:** `offers`, `pending_offers`.

This is where deals start. An offer is a written proposal to buy a property.

**Create an offer:** pick a client, enter the property address, offer amount, conditions, deadlines (financing, inspection, closing). Save. The system formats it into a presentable PDF using the built-in PDF export.

**Pending offers:** offers that haven't been formally sent yet sit in `pending_offers` for editing. Once you "send," they move into the `offers` table.

**Pipeline:** accepted offers automatically promote to the Pipeline (Section 7).

**Requests tab:** clients (or stakeholders) can request changes to an offer through their portal. Those requests show up here for Maxwell to action.

---

## 7. Pipeline (the deal tracker)

**Where:** Pipeline tab.
**File:** `js/offers.js` (the Pipeline view), `js/tracker.js` (deal progress widget).
**Tables:** `pipeline`, `pipeline_tasks`, `checklist_items`.

Once an offer is accepted, it lives in the Pipeline until closing. Each row is a deal in flight.

**Stages:** Acceptance → Financing → Inspection → Walkthrough → Closing. Each stage has a deadline (`acceptance_date`, `financing_date`, `inspection_date`, `walkthrough_date`, `closing_date`).

**Transaction Room:** tap any deal to open its detail view. Inside you see:

- Property details (address, MLS number, price, deposit).
- All five stage deadlines with countdown timers.
- A checklist of tasks (`pipeline_tasks`) — financing approval, inspection scheduled, lawyer engaged, etc. Tick items off as they happen.
- A document area for uploaded contracts, inspection reports, and lender letters.
- An activity timeline for that specific deal.

**Daily reminders:** every morning the daily-automation function (Section 19) checks for upcoming deadlines and pushes a notification: "Inspection deadline for 16 Knightsbridge in 2 days."

**PDF export:** the Pipeline screen has a button to export the entire deal to PDF for handoff to a lawyer or lender.

**Archive a deal:** once closed, archive it. Archived deals are stamped with `archived_at` (migration 026) and moved out of the active view but kept for commission tracking.

---

## 8. New Builds

**Where:** New Builds tab.
**File:** `js/newbuilds.js`, `js/extras.js` (some shared logic).
**Table:** `new_builds`.

When a client buys a not-yet-built home, that's a "new build." The build can take 12–18 months and the brokerage has to keep both the client and the builder informed.

Each build record tracks:

- **Client info** (name, email).
- **Builder info** (`builder_name`, `builder_email`, `community`, `lot_address`).
- **Stage** (current_stage: 1–9 milestones, e.g. permit, foundation, framing, drywall, finishings, occupancy, etc.).
- **Estimated completion date.**
- **MLS number** (propagated from the original offer — see migration 025).

**Builder Portal:** every build has a public URL (`builder.html?token=…`) the builder can visit to upload progress photos and tick off milestones. No login required. The builder portal has been refined twice — the current production version is `builder-portal.js`, with `builder-portal-v2-B.js` as the staging version.

**Build progress page:** clients see their own version of the same build (`portal.html?token=…`) with photos and milestone status — but cleaned up for client eyes.

**Builder visit loop:** when a build hits a milestone needing inspection, the system can email the builder a calendar invite for a site visit (migration 019).

---

## 9. Commissions

**Where:** Commissions tab.
**File:** `js/extras.js` (Commissions section).
**Table:** `commissions`.

Tracks earnings on closed deals. Each row pulls from the closed Pipeline entries.

**Auto-calculation:** commission = sale price × commission rate (configurable per deal). Default is 2.5%.

**Splits:** if a co-listing agent is involved, the split percentage is recorded.

**Year-to-date:** the screen shows a running YTD total, broken out by month. Useful for tax season and for benchmarking against goals.

---

## 10. Reports

**Where:** Reports tab.
**File:** `js/extras.js`.
**Tables:** `reports` plus aggregations across `clients`, `viewings`, `offers`, `pipeline`.

Pre-built reports for monthly review:

- **Month-over-month volume** — viewings booked, offers written, deals closed.
- **Conversion funnel** — leads → showings → offers → closings.
- **Client lifetime value** (since first contact).
- **Source attribution** — where each client came from (referral, intake form, broadcast).

Tap any report to drill in or export to PDF.

---

## 11. Email (Inbox + Send)

**Where:** Email tab.
**Files:** `js/extras.js` (Email Send + Email Inbox), `js/notifications.js` (templates).
**Edge function:** `supabase/functions/send-email/`.
**Tables:** `email_inbox`, `approval_queue`.

This is a two-way Gmail integration.

**Sending:** Maxwell composes an email inside the app. The `send-email` edge function authenticates against Gmail's API using stored OAuth credentials and sends the message from Maxwell's real Gmail account. The body, recipient, subject, and timestamp are saved to `email_inbox` so the conversation thread stays intact. **Every outbound email signs off as eXp Realty** — see CLAUDE.md.

**Inbox sync:** the `fetch-inbox` edge function pulls Gmail every few minutes and writes new messages to `email_inbox`, keyed by `gmail_thread_id` so replies thread correctly.

**Templates:** `js/notifications.js` holds every templated email — viewing confirmation, viewing reminder, offer sent, offer accepted, build update, closing congratulations, etc. Each template has placeholders that get filled at send time (client name, property address, dates).

**Approvals queue:** by default, every email queued by the system lands in `approval_queue` first. Maxwell reviews on the Approvals screen (Section 12) and taps Approve to actually send. Some templates have **auto-approve** enabled — those skip the queue and call `Approvals.approve()` directly.

**Rate limiting:** migration 017 enforces a per-recipient rate limit so the system can't accidentally spam.

---

## 12. Approvals

**Where:** Approvals tab.
**File:** `js/extras.js`.
**Table:** `approval_queue`.

Every system-generated email passes through here unless auto-approve is set. The screen shows:

- **From / To / Subject** — who's getting it.
- **Body preview** — the full templated email.
- **Approve** — sends now via the send-email function.
- **Edit** — modify the body before sending.
- **Reject** — discard the email; nothing leaves the building.

This is the safety net. Maxwell sees every word the system wants to send before it goes.

---

## 13. Broadcast

**Where:** Broadcast tab.
**File:** `js/extras.js`.

Send a single message to a filtered list of clients at once. Useful for:

- "Open house this Saturday at 16 Knightsbridge."
- "Spring market update."
- "We're now licensed in Newfoundland — your referrals welcome."

The flow: choose a filter (active clients, past clients, leads), write the message, preview, send. Each individual email goes through the approval queue (or auto-approve if configured).

---

## 14. Calendar

**Where:** Calendar tab.
**File:** `js/calendar.js`.

A unified calendar showing every dated event in the system: viewings, offer deadlines, pipeline deadlines, builder visits, closings. Tap any event to jump to its source.

Same date logic everywhere: dates are formatted via `App.fmtDate()` which handles both plain `YYYY-MM-DD` and full Supabase timestamps.

---

## 15. Analytics + Portal Traffic

**Where:** Analytics tab and Portal Traffic tab (separate screens).
**Files:** `js/analytics.js` (charts), `js/portal-traffic.js` (portal views).
**Charting library:** Chart.js.
**Tables:** `portal_views`, plus aggregations.

**Analytics screen** is the high-level dashboard — bar charts and line charts of viewings per month, offers per month, conversion ratios, sources of business.

**Portal Traffic screen** answers a different question: "did the link I sent actually get opened?" Every time a client, builder, lawyer, lender, or stakeholder opens a portal link, a row is inserted into `portal_views`. The screen shows:

- **Stat cards** — total views, today's views, unique clients, top portal type.
- **Views over time chart** — 7-, 30-, or 90-day line chart split by portal type (Client / Builder / Stakeholder), each in its own color.
- **By Viewer table** — one row per (deal × recipient). So if McCrowe Homes opened the build link Maxwell sent for Zinabu's deal, you see "McCrowe Homes [Builder] · Builder portal · 6" as its own row, separate from "Zinabu Yakubu [Client] · Client portal · 8." Each row shows a role badge and a subline with the deal owner and address.
- **Recent Portal Views feed** — the last 20 opens, each with timestamp, portal type pill (color-coded), recipient name, and deal context. Each row has a "Mark as self" button — use it to flag a view as your own self-test so it's excluded from totals.

This is the screen that confirms "yes, the builder actually clicked the link I sent."

---

## 16. Activity Log

**Where:** Activity tab.
**Table:** `activity_log`.

Every meaningful action in the system gets logged: client created, viewing booked, offer sent, email approved, milestone ticked, portal opened. The screen is a reverse-chronological feed.

Each entry stores the actor (always Maxwell), the verb (created, sent, marked complete), the object (the client/deal/offer ID), and a timestamp. This is the audit trail.

---

## 17. AI Assistant ("Ask AI")

**Where:** purple Ask AI button (top right of every screen).
**File:** `js/ai.js`.
**Edge function:** `supabase/functions/claude-chat/`.
**Model:** Claude Haiku.

Tap the button. A chat panel slides in. Ask anything: "Who's closing this month?" "Draft an email to the McCrowe builder about the 16 Knightsbridge framing inspection." "What's my YTD commission?"

The assistant has read access to a curated subset of the database — clients, recent viewings, active builds, open pipeline deals — and feeds that context into Claude before answering. It can draft emails, summarize a deal, or pull stats on demand. It cannot send emails or edit data; it's read-only and advisory.

---

## 18. Push Notifications

**Files:** `sw.js` (service worker), `js/app.js` (`subscribePush`, `sendWebPush`), `supabase/functions/send-push/` (VAPID Web Push).
**Tables:** `push_subscriptions`.

When the PWA is first installed, the app asks "Allow notifications?" Tap Allow. The browser hands back a VAPID subscription (P-256 / JWK key format). That subscription gets stored in `push_subscriptions` keyed to Maxwell's user ID.

From then on, anytime the system needs to alert Maxwell — a viewing response, a new offer, a builder portal open, a daily morning briefing — the `send-push` edge function reads the stored subscription, signs a VAPID JWT, and pushes the notification through Apple's / Google's push servers. The notification arrives on the phone even when the app is closed.

To re-subscribe (e.g. after wiping the phone), just open the app and tap the bell icon → Re-enable push.

---

## 19. Daily Automation

**Files:** `js/notifications.js` (Notify.queue + daily logic).
**Edge functions:** `supabase/functions/daily-automation/`, `morning-briefing/`, `check-followups/`.
**Cron:** scheduled in migration 002 and 008.

Three jobs run automatically:

1. **Morning briefing (8:00 AM):** scans today's viewings, today's offer deadlines, and any closing dates within 7 days, then sends a Web Push to Maxwell's phone summarizing the day. Stored in `morning-briefing/`.
2. **Follow-up checker (every 4 hours):** finds clients who haven't been contacted in 14+ days and queues a follow-up email to the approval queue. Stored in `check-followups/`.
3. **Backup (nightly 2:00 AM):** dumps the database to a backup table so accidental deletions can be reversed for 30 days. Stored in `backup-data/`.

All three are scheduled inside Supabase using `pg_cron`.

---

## 20. System Health

**Where:** Settings → System Health.
**File:** `js/extras.js`.

A diagnostic screen showing:

- Last successful Gmail sync.
- Last successful push notification.
- Edge function health (each one pinged, latency shown).
- Push subscription count.
- Database row counts per table.
- Cron job last-run timestamps.

If anything looks red, the issue is most likely a Supabase service outage or an expired Gmail OAuth token. The fix for the latter: **Settings → Re-authenticate Gmail** (re-runs the OAuth flow).

---

## 21. Settings

**Where:** Settings tab.
**File:** `js/extras.js`.

Per-agent configuration:

- **Profile** — name, email, phone, brokerage (eXp Realty), license number.
- **Email signature** — the block appended to every outbound email.
- **Auto-approve toggles** — which notification templates skip the approval queue.
- **Theme** — light or dark.
- **Push** — re-subscribe / disable.
- **Re-authenticate Gmail** — runs the OAuth flow again if Gmail starts rejecting sends.
- **Privacy mode** — toggles the masking on the Clients screen.

---

## 22. Public Pages (no login)

These are the URLs that get sent to clients, builders, lawyers, and lenders. None of them require a login — they're tokenized, time-limited, and revocable.

| Page | File | Who gets it | What it does |
|---|---|---|---|
| **Respond** | `respond.html` | Buyers/sellers responding to a viewing or stakeholder request | Confirm, reschedule, cancel |
| **Portal** | `portal.html` | Clients tracking their deal | Pipeline progress, milestones, documents |
| **Intake** | `intake.html` | New leads | Fill out new-client questionnaire |
| **Builder portal** | `builder.html` | Builders | Upload progress photos, tick milestones |
| **Stakeholder portal** | `stakeholder.html` | Lawyers, lenders, co-buyers | View deal status with limited info |

Tokens for all of these are stored in `viewing_responses`, `deal_stakeholders`, `new_builds.builder_token`, and similar columns. They expire after 90 days by default (configurable per token). Revoke any token from the Settings or the deal's Transaction Room.

---

## 23. Database Tables (Supabase)

The full table list, what each one stores, and where it's used:

| Table | Purpose | Used in |
|---|---|---|
| `clients` | Buyer/seller master list | Clients screen |
| `viewings` | Showing bookings | Viewings, Calendar |
| `viewing_responses` | Client confirm/reschedule/cancel | Viewings, Push notifications |
| `offers` | Live and sent offers | Offers screen |
| `pending_offers` | Drafts not yet sent | Offers screen |
| `pipeline` | Accepted deals in flight | Pipeline screen |
| `pipeline_tasks` | Per-deal task list | Transaction Room |
| `checklist_items` | Per-deal checklist | Transaction Room |
| `commissions` | Earnings on closed deals | Commissions screen |
| `reports` | Saved report snapshots | Reports screen |
| `activity_log` | Audit trail of every action | Activity screen |
| `approval_queue` | Pending outbound emails | Approvals screen |
| `push_subscriptions` | VAPID subscriptions per device | Push notifications |
| `agents` | Agent profiles (currently just Maxwell) | Settings |
| `intake_responses` | Submissions from `intake.html` | Clients screen |
| `client_responses` | Generic client replies (forms, surveys) | Responses screen |
| `new_builds` | Build progress tracking | New Builds screen |
| `form_responses` | Custom form submissions | Form Responses screen |
| `email_inbox` | Two-way Gmail sync | Email screen |
| `deal_stakeholders` | Lawyers/lenders/co-buyers per deal | Stakeholder portal |
| `portal_views` | Every portal open | Portal Traffic screen |

Row-Level Security (RLS) is enforced everywhere — see migration 007 for the hardening pass and migration 020 for builder portal security. Tokens scope what the public pages can read.

---

## 24. Configuration & Deployment

**Front-end deployment:** GitHub `master` branch is auto-deployed to Vercel. Push to `master` and within ~30 seconds the new version is live globally on Vercel's CDN. There's no build step — vanilla HTML/JS/CSS is served directly.

**`config.js`** (root of repo) holds three things:

1. `SUPABASE_URL` — the Supabase project URL.
2. `SUPABASE_ANON_KEY` — the public client key (RLS protects what it can read).
3. `VAPID_PUBLIC_KEY` — for Web Push subscription.

**Service Worker** (`sw.js`) — handles offline cache and Web Push delivery. It cache-busts on each deploy via a version string at the top of the file.

**Vercel** (`vercel.json`) — sets headers, redirects, and ensures the service worker has the right scope.

**Supabase Edge Functions** are written in TypeScript / Deno and deployed via the Supabase CLI:

```bash
supabase functions deploy send-email
supabase functions deploy send-push
supabase functions deploy claude-chat
supabase functions deploy fetch-inbox
supabase functions deploy daily-automation
supabase functions deploy morning-briefing
supabase functions deploy check-followups
supabase functions deploy backup-data
```

Each function reads its own secrets from Supabase's secret store (Gmail OAuth tokens, VAPID private key, Anthropic API key).

**Migrations** live in `supabase/migrations/` and are applied with `supabase db push` from a machine with the CLI installed and logged in. They're numbered sequentially (`001_…` to `026_…`) and must be applied in order on a fresh database.

---

## 25. The Five Surgical Update Rules

These rules live in `CLAUDE.md` and govern every change to the codebase. Anyone editing this app — human or AI — must follow them:

1. **Read before editing.** Use grep or read the file first; never blind-edit.
2. **One function at a time.** Change only the specific block requested. Leave everything else untouched.
3. **Show the diff first.** For non-trivial changes, BEFORE / AFTER must be visible before applying.
4. **Web-search before implementing new features.** Check current best practices and standard APIs.
5. **Verify before committing.** Run `node --check` or grep the changed file before staging.

Commit format:

```bash
git add <only the specific files changed>
git commit -m "fix/feat/chore: <what changed and why>"
git push origin master
```

---

## 26. Common Operating Procedures

**A new buyer client comes in:**
1. Clients tab → `+` → fill name, email, phone → Save.
2. Tap their card → "Send intake form" → email goes through approvals.
3. They submit; you get a push.
4. Their answers populate the Responses tab on their profile.

**Booking a showing:**
1. Viewings → `+` → pick client, address, date, time.
2. Save. Confirmation email + .ics calendar invite goes out (after approval if not auto-approved).
3. Client taps respond link, confirms.
4. Push notification fires.
5. After the showing, the auto-completion modal asks for feedback.

**Writing an offer:**
1. Offers → `+` → pick client, fill property, amount, conditions.
2. Save → PDF is auto-generated.
3. Send to client / co-agent through approvals.
4. On acceptance, manually mark as accepted → it auto-promotes to Pipeline.

**Tracking a new build:**
1. New Builds → `+` → pick the client, fill builder name, builder email, lot address, MLS, est completion.
2. Save → builder gets emailed a portal link automatically.
3. Builder logs progress at `builder.html?token=…`.
4. Client sees a clean version at `portal.html?token=…`.
5. Maxwell watches both via the Portal Traffic screen.

**Closing a deal:**
1. Pipeline → tap the deal → tick remaining checklist items.
2. Set closing date completed.
3. The deal auto-flips to Archived → it appears in Commissions for the YTD total.
4. Send a closing congratulations email (template auto-fires).

---

## 27. When Things Break

| Symptom | Most likely cause | Fix |
|---|---|---|
| Push notifications stop arriving | VAPID key mismatch or expired subscription | Settings → Re-enable push |
| Outbound emails stop sending | Gmail OAuth token expired | Settings → Re-authenticate Gmail |
| A screen is blank | JS error — open browser console (or Safari → Develop → iPhone) | Look for the red error, file an issue, redeploy |
| Approval queue isn't draining | Cron stopped | Check System Health → cron status |
| Portal link gives 404 | Token revoked or expired | Settings → Tokens → re-issue |
| Login loops back to login screen | Supabase Auth refresh failing | Clear site data, sign in fresh |

If the whole site is down, check Vercel's deployment status first (it auto-deploys from `master`), then Supabase's status page.

---

## 28. The 30-second pitch

Maxwell DealFlow is a one-person brokerage's entire operating system in a single PWA. It tracks every client from lead to closing, sends every email and notification automatically, gives the builder and the lawyer their own portal, and runs on a phone in offline mode. It deploys with a single `git push`. It costs roughly $20/month to run (Supabase + Vercel + the Anthropic API calls for Ask AI). And it gives a solo agent the operational leverage of a small team.

That's the whole system.
