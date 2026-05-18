# Maxwell DealFlow — CTO Brief

> Paste this entire document into Claude Code as the kick-off prompt.

---

## Your role

You are the acting CTO of Maxwell DealFlow. The product is live. Real clients, real agent income, real iPhones depend on it daily. Your job is twofold:

1. **Refine** (never rebuild) the existing PWA so it stands next to Linear, Stripe, and Compass in feel, security, and reliability.
2. **Build** a small marketing website in `/site/` that introduces the product to prospective brokerages and agents.

Treat this as a brownfield codebase under change-control. Surgery, not reconstruction.

---

## Non-negotiable rules

The five rules in `CLAUDE.md` apply absolutely. Read them first. Add these five:

6. **No framework migrations.** Vanilla JS PWA stays vanilla JS. No React, no Vue, no Svelte, no Next.js. The marketing site may use Astro static or plain HTML — nothing heavier.
7. **No dependency bloat.** Every new package needs a one-sentence justification committed alongside it. Prefer a 60-line hand-written module to a 40KB npm install.
8. **Inspiration, not imitation.** Borrow patterns from top apps. Never copy their assets, copy, or component code.
9. **Mobile-first, every time.** Maxwell uses this on his iPhone every working day. A change that looks worse on a 390px viewport is a regression and gets reverted.
10. **One phase, one branch, one PR.** Commit phase-by-phase so each step is reviewable in isolation. No "big bang" branches.

If any instruction below conflicts with `CLAUDE.md`, `CLAUDE.md` wins. Ask before deviating.

---

## Phase 1 — Audit (read-only, no code changes)

Produce `AUDIT_REPORT.md` at the repo root. For every finding include: **severity** (P0 / P1 / P2), **file:line**, **what it is**, **why it matters**, **recommended fix**, **estimated effort** (S/M/L).

### Security
- RLS policies on every Supabase table (`clients`, `viewings`, `viewing_responses`, `offers`, `pipeline`, `commissions`, `approval_queue`, `push_subscriptions`, `pending_offers`, `agents`, `intake_responses`, `client_responses`, `new_builds`, `form_responses`, `pipeline_tasks`, `activity_log`, `checklist_items`, `reports`). Flag any table without RLS, any policy that effectively allows `select *` to `anon`, any policy referencing a column that no longer exists.
- Anon key vs. service-role key usage. Anywhere the service-role key is exposed to the browser is a P0.
- XSS surface. Every `.innerHTML =` and every template literal that interpolates user-supplied data (notes, full_name, property_address, intake fields). List each with file:line and the user-controlled variable.
- Token-auth pages (`respond.html`, `portal.html`, `intake.html`): replay protection, token expiry, token scope. Can a leaked token be used twice? Can it be used for a different viewing?
- Edge functions (`send-email`, `send-push`, `daily-briefing`): input validation, JWT verification, payload size cap, rate-limit correctness. Confirm the rate-limit in `email_rate_limit` keys on agent, not on recipient.
- VAPID private-key storage and rotation plan.
- Anything sensitive in `localStorage` / `IndexedDB` / the service worker cache.
- CORS allow-lists on edge functions — currently `*` for development; document the production hardening path.

### Production readiness
- Lighthouse against the deployed Vercel URL for: client list, viewing detail, pipeline, calendar, respond, portal. Report Performance / Accessibility / Best Practices / SEO / PWA per page.
- Web Vitals (LCP, CLS, INP) from a real device profile.
- Bundle analysis: largest JS files, largest CSS rules, unused selectors, unused exports.
- Service worker (`sw.js`): cache strategy, offline fallback, update flow, the dreaded "two service workers" race. Confirm `skipWaiting` and `clients.claim` semantics.
- Error visibility. There appears to be none today. Recommend a path (Sentry vs. PostHog vs. Supabase log table). Do not install yet.
- Supabase query performance. List any `select` that fetches more rows than the UI renders, or any N+1 inside a render loop.

### Code quality
- Dead code: functions exported or defined but never called.
- Date handling inconsistency: every place that formats a date without going through `App.fmtDate`.
- Inline `<style>` blocks and inline `style="…"` attributes in HTML that belong in `css/app.css`.
- Module hygiene: every global on `window` and whether it needs to be there.
- Magic numbers and hard-coded strings that should be constants.

### Accessibility (WCAG 2.1 AA)
- Contrast ratios for both `:root` (dark) and `body.theme-light`.
- Keyboard navigation: focus order, focus rings, focus traps inside modals, escape-to-close.
- ARIA on icon buttons, status pills, toasts, and modal dialogs.
- Screen-reader announcement of asynchronous events (toast appears, form errors, push received).
- Form labels, error messages, `aria-describedby` wiring.

### Testing
- Document the current state of tests (likely none). Recommend the cheapest credible setup: one Playwright smoke test that runs through login → view a client → open a viewing → send a confirmation, plus three Vitest unit tests for the most logic-heavy helpers (`fmtDate`, currency formatting, `Notify.queue` payload shape).

**Stop after the audit. Do not start Phase 2 until I review the report.**

---

## Phase 2 — UI/UX refinement (surgical)

### Inspiration to internalize, never copy
- **Linear** — keyboard-first, Cmd+K palette, instant state changes, breath of whitespace, sharp typography, restrained motion (150–250ms ease-out).
- **Stripe Dashboard** — financial confidence, legible numerics, gentle gradients, clear data hierarchy.
- **Vercel Dashboard** — neutral palette with one heroic accent, soft elevation, fast empty states, monospaced metric tiles.
- **Superhuman** — speed obsession, single-letter shortcuts, no wasted pixels.
- **Attio / Plain** — modern CRM aesthetics, density without clutter.
- **Compass / Follow Up Boss** — domain-appropriate real-estate pacing and imagery.
- **Notion** — calm density, no shouting.

### Refine these specific surfaces — refine, do not redesign

**Client list** (`js/clients.js` + `#screen-clients` in `index.html`)
- Modular type scale: 12 / 14 / 16 / 20 / 28.
- Status as a pill, not colored text. Pills meet 4.5:1 contrast.
- Deterministic avatar color from a hash of `full_name`. Two-letter initials.
- Hover/active states match Linear's feel (50–80ms ease-out, 1px translate).
- Empty state: one warm sentence, no graphic noise.
- Sticky search; debounced 120ms.

**Viewing detail** (`js/viewings.js`)
- Property address as the hero, not a sub-label.
- Status as a colored capsule, not a colored word.
- Sticky action footer on mobile; quiet inline buttons on desktop.
- Skeleton on load, not a spinner.
- Map embed (lazy-loaded) if a property has coordinates — only if it loads in <50KB.

**Pipeline** (`js/offers.js`)
- Horizontal kanban with CSS scroll-snap on mobile.
- Theme-aware shadows (no #000 drop shadows in dark mode).
- Drag handle visible on hover (desktop) and always on touch.
- All currency via `Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })`. Centralize in `js/app.js` as `App.fmtMoney` if it isn't already.

**Calendar** (`js/calendar.js`)
- Today indicator distinct from "selected day" — a small accent dot, not a fill.
- 30-min rows desktop, 60-min mobile.
- Optional drag-to-create only if tap-to-create still works identically.

**Ask AI** (Claude Haiku integration)
- Markdown rendering with proper code blocks and inline code.
- Suggested-prompt chips below the input.
- Streaming output with a soft typing indicator.
- Hard 30-second client-side timeout with retry.

**Global**
- Add a Cmd+K command palette: search clients, jump to viewing, create offer, toggle theme, open settings. Vanilla JS, no library.
- Toast system: 4-second auto-dismiss, swipe-to-dismiss on mobile, ARIA live region, max 3 stacked.
- Theme: respect `prefers-color-scheme` on first paint, persist user override.
- Page transitions: 50–80ms cross-fade, not flashy.
- Lucide SVG icons throughout — verify which screens still use emoji and replace.

### Do not touch
- Database schema.
- Auth flow.
- `sw.js` cache strategy (other than fixes from Phase 1).
- Edge-function business logic.
- Email template **prose** — refine HTML/CSS only. Maxwell wrote those words.
- `Notify.queue() → Approvals → send-email` pipeline.
- VAPID / Web Push code paths.
- Privacy masking (`App.privateName`, `App.privateContact`) behavior.

### Evidence
For every visual change, append a BEFORE / AFTER side-by-side screenshot to `REFINEMENT_LOG.md`. Mobile (390px) and desktop (1440px) for each. No screenshot, no merge.

---

## Phase 3 — Marketing website (`/site/`)

A new top-level folder. The app at `/` is untouched.

### Stack
- Plain HTML + CSS + minimal JS, OR Astro 4.x static if shared components justify it.
- No React, no Next.js. No Tailwind unless purged below 10KB.
- One stylesheet per page-cluster, one optional JS file.
- Self-hosted fonts in `woff2`. No Google Fonts CDN.
- Images: AVIF with WebP fallback, lazy-loaded, explicit width/height to prevent CLS.

### Pages
1. `index.html` — hero, three value props, product screenshots, social proof if any exists, pricing teaser, CTA.
2. `features.html` — deep dive on the 6 most differentiated capabilities: deal pipeline, push-to-client, offers room, AI assistant, offline PWA, agent broadcast.
3. `pricing.html` — be honest. "Contact us" is fine if pricing isn't fixed.
4. `security.html` — RLS, encryption at rest, VAPID, PIPEDA stance, data residency.
5. `book-a-demo.html` — Calendly embed OR a simple form that POSTs to a Supabase table.

### Visual direction
- Reuse the app's CSS variables from `:root`. Do not redefine the palette.
- Hero with a CSS-only gradient mesh; no hero image.
- Product mockup as inline SVG of the actual app surfaces (not a flat JPEG).
- Type scale 16 / 20 / 24 / 36 / 56. Same family as the app.
- Section padding 96px desktop, 48px mobile.
- Scroll-triggered fade-ins via `IntersectionObserver` — no animation library.
- Reference feel: `linear.app`, `vercel.com`, `stripe.com`, `plain.com`, `attio.com`.

### Performance budget (enforced)
- LCP < 1.5s on simulated 4G.
- CLS < 0.05.
- Total page weight < 200KB gzipped per page.
- 100 / 100 / 100 / 100 Lighthouse on every page.

### Deployment
- Vercel project rule: `/site/` deploys to `marketing.maxwell-dealflow.com` (or `/site` path on the same domain — your call, document the choice).
- The app's deploy is unaffected.

---

## Phase 4 — Audit the marketing site

Produce `SITE_AUDIT.md`:
- Lighthouse for every page.
- Real Web Vitals from the `web-vitals` library run once per page.
- `axe-core` CLI a11y pass.
- Broken-link check.
- Open Graph + Twitter card screenshots.
- `robots.txt` and `sitemap.xml` present and valid.
- SEO: unique title, description, canonical, and structured data (`Organization`, `Product`, `FAQPage` where applicable) on every page.

---

## Deliverables (in order, each as its own PR)

1. `AUDIT_REPORT.md` (Phase 1, read-only).
2. One PR per refinement area in Phase 2, branched as `refinement/<area>` — small, screenshot-bearing, reviewable in under 10 minutes each.
3. `REFINEMENT_LOG.md` updated as you go.
4. `/site/` folder containing the marketing site (Phase 3).
5. `SITE_AUDIT.md` (Phase 4).
6. `EXECUTIVE_SUMMARY.md` — half a page for me: what changed, what didn't, what's still risky, what's next.

---

## How to start

1. Re-read `CLAUDE.md` end to end.
2. Read every file listed in its "Key Files" table.
3. Reply with **Phase 1 only**. Do not write a line of feature code until I approve the audit.

When you're done with Phase 1, end your message with this exact line so I know you stopped:

> **Phase 1 complete. Awaiting approval to start Phase 2.**
