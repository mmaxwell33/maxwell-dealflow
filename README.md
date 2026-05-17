# Maxwell DealFlow CRM

Custom real-estate CRM for **Maxwell Delali Midodzi**, REALTOR® at eXp Realty
in St. John's, Newfoundland. Phone-installable PWA, daily-use production tool
for managing real clients and real deals.

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | Vanilla JS PWA (no framework) | Fast, offline-capable, installable on iPhone |
| Hosting | Vercel (auto-deploys from `master`) | Zero-config, instant global CDN |
| Database | Supabase (PostgreSQL + RLS) | Real-time, auth, storage, edge functions |
| Email | Supabase Edge Function → Gmail API | Sends from Maxwell's real Gmail |
| Push | Web Push / VAPID (RFC 8291) | Background push to phone even when app is closed |
| AI | Claude Haiku via Supabase Edge Function | In-app Ask AI feature |
| Tests | Vitest (unit) + Playwright + axe-core (e2e + a11y) | CI safety net on every PR |

## Quick start (local development)

```bash
git clone https://github.com/mmaxwell33/maxwell-dealflow.git
cd maxwell-dealflow

# Run tests
npm install
npm test              # vitest unit tests
npm run test:e2e      # playwright + axe (requires npm run serve in another tab)

# Serve the app locally (no build step needed)
npm run serve         # localhost:3000
```

The site talks to the production Supabase project even in local dev — there's
no separate dev DB. Be mindful when adding/editing data.

## Key files

- `index.html` — agent app shell, all screens and modals.
- `js/app.js` — core auth, routing, helpers (`fmtDate`, `fmtMoney`, `esc`,
  `escAttr`, `logError`).
- `js/clients.js`, `js/viewings.js`, `js/offers.js`, `js/extras.js`,
  `js/notifications.js`, etc. — one module per surface.
- `respond.html`, `portal.html`, `intake.html`, `seller-intake.html` —
  public, no-login pages clients reach via token links.
- `supabase/migrations/` — versioned SQL, run in order via Supabase
  Dashboard's SQL Editor.
- `supabase/functions/` — Deno edge functions (deploy with
  `supabase functions deploy <name>`).
- `css/app.css` — single stylesheet, CSS variables in `:root`.

## Deeper docs

- **[CLAUDE.md](CLAUDE.md)** — the project's rules for any AI assistant working
  on the codebase. Read first if you're a tool.
- **[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)** — long-form narrative of every
  feature surface for Maxwell.
- **[MAXWELL_DEALFLOW_SYSTEM_GUIDE.md](MAXWELL_DEALFLOW_SYSTEM_GUIDE.md)** —
  business + technical context, investor-readable.
- **[AUDIT_REPORT.md](AUDIT_REPORT.md)** — 2026 read-only audit of the entire
  codebase. P0/P1/P2 findings with file:line.
- **[REFINEMENT_LOG.md](REFINEMENT_LOG.md)** — every PR landing in Phase 2 gets
  an entry with closes/approach/files/risk/verification.
- **[DEPLOY.md](DEPLOY.md)** — how to deploy, roll back, apply a migration,
  redeploy an edge function.
- **[SECRETS.md](SECRETS.md)** — inventory of every secret and how to rotate.
- **[docs/testing-checklist.md](docs/testing-checklist.md)** — manual QA pass.

## Brokerage facts

- **Real broker:** eXp Realty (NOT Royal LePage — older copies of some docs
  have the wrong brokerage).
- **Sending email address:** `maxwelldelali22@gmail.com` (Gmail OAuth via the
  `send-email` edge function).
- **Display email:** `Maxwell.Midodzi@exprealty.com` (used in intake/respond
  pages and outgoing email signatures).

## CI

Every push to `master` and every PR runs:

1. `vitest run` — 19 unit tests covering `App.esc`, `App.escAttr`,
   `App.fmtDate`, `App.fmtMoney` with regression cases for the XSS attack
   strings.
2. `playwright test` — 3 public-surface smoke tests (lock screen, buyer
   intake, seller intake). Verifies no console JS errors.
3. `axe-core` (informational) — WCAG 2.1 AA violations log to CI output but
   don't fail the build yet. Each violation gets fixed in its own small PR.

GitHub Actions workflow lives at `.github/workflows/ci.yml`. Budget < 4 min.

## Status

Phase 2 of the 2026 refinement plan is in progress. See `REFINEMENT_LOG.md`
for the running list of shipped PRs.
