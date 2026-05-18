# Maxwell DealFlow — Phase 1 Audit Report

**Prepared for:** Albert
**Date:** 2026-05-13
**Mode:** Read-only. No code changed.
**Scope:** Full PWA (`/`), token-auth public pages (`respond.html`, `portal.html`/`stakeholder.html`, `intake.html`, `seller-intake.html`, `build.html`), 9 Supabase edge functions, 39 SQL migrations, service worker, manifest, Vercel config.
**Codebase size:** ~28,700 LOC across HTML/JS/CSS/SQL/TS.

> **Severity legend** — **P0** = ship-blocker / data-leak / live exploit. **P1** = needs fix before next big surface change; demonstrable user-impact or regulatory risk. **P2** = polish / hygiene / nice-to-have.
> **Effort** — **S** = ≤ 1 hour, **M** = half day, **L** = a day or more.

---

## 0. Executive summary

The product works. The crypto in `send-push` is correct, the Gmail OAuth flow is solid, the rate limiter is now DB-backed, and the Claude key is finally server-side. The visible UI on the agent side is feature-complete.

But three things stop me from calling this production-grade for anything beyond Maxwell's personal use:

1. **The anon RLS posture on `viewing_responses` / `viewings` / `pending_offers` / `client_intake` is effectively open.** A polite `curl` against the Supabase REST endpoint dumps every token, every client name, every property price, every list of pending offers. The `respond.html` "14-day token" is enforced *only* client-side; the server policies say `USING (true)`. This is the single most important finding in the report.
2. **`App.esc` does not escape single quotes.** Dozens of `onclick="X.fn('${App.esc(name)}')"` handlers are constructed from user-controlled input. A client name with `'` breaks the click; a client name crafted by an unauthenticated intake submission triggers stored XSS in the agent's authenticated DOM. Trivial to exploit, trivial to fix.
3. **There is no observability.** No Sentry, no PostHog, no Supabase logs table queried by the app. When `setTimeout(..., 5000)` cascades silently fail on a slow phone, nobody notices until Maxwell complains.

Everything else (bundle weight, accessibility, mobile-first CSS, dead code, doc clutter) is real but recoverable. Fix the three above and the rest can land phase-by-phase under refinement branches.

**Finding count:** 12 P0 · 24 P1 · 21 P2.

---

## 1. Security

### 1.1 Row-Level Security on Supabase tables

I read every RLS-creating migration (007, 014, 015, 018, 020, 030, 032, 033, 034, 037, 038, 039) and cross-referenced against the tables the public pages write to.

| Table | RLS on? | Anon read? | Anon write? | Verdict |
|---|---|---|---|---|
| `agents` | ✅ | ✗ | ✗ (own only) | OK |
| `clients` | ✅ | ✗ | ✗ (own only) | OK |
| `viewings` | ✅ | ✗ | **✅ via any non-expired token** | **P0 — see 1.1.2** |
| `offers` | ✅ | ✗ | ✗ | OK |
| `pipeline` | ✅ | ✗ | ✗ | OK |
| `approval_queue` | ✅ | ✗ | ✗ | OK |
| `email_inbox` | ✅ | ✗ | ✗ | OK |
| `activity_log` | ✅ | ✗ | ✗ | OK |
| `new_builds` | ✅ | ✗ | ✗ | OK |
| `commissions` | ✅ | ✗ | ✗ | OK (gated on table exists) |
| `deal_checklist` | ✅ | ✗ | ✗ | OK |
| `viewing_responses` | ✅ | **✅ ALL ROWS** | **✅ ALL ROWS** | **P0 — see 1.1.1** |
| `pending_offers` | ✅ | ✗ | **✅ insert anything** | **P1 — see 1.1.3** |
| `client_intake` | ✅ | ✗ (auth required) | ✅ insert anything | P1 — see 1.1.4 |
| `email_rate_limit` | ✅ | ✗ (service role only) | ✗ | OK |
| `listings` | ✅ | ✗ | ✗ | OK |
| `disclosures` | not verified | ? | ? | needs check |
| `client_contacts` | not verified | ? | ? | needs check |
| `deal_documents` | not verified | ? | ? | needs check |

#### 1.1.1 P0 — `viewing_responses` is world-readable

[supabase/migrations/015_respond_page_fix.sql:39](supabase/migrations/015_respond_page_fix.sql)
```sql
CREATE POLICY "viewing_responses_anon_select" ON viewing_responses
  FOR SELECT USING (true);

CREATE POLICY "viewing_responses_anon_update" ON viewing_responses
  FOR UPDATE USING (expired = false AND expires_at > now());
```

**What it means.** Anyone holding the public anon key — which sits in every JS bundle and every shared `respond.html` link — can fetch the *entire* `viewing_responses` table:

```bash
curl -s "https://bxwmbrdndsetjwcexwpc.supabase.co/rest/v1/viewing_responses?select=*" \
  -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
```

That dump contains, for every viewing ever booked: `client_name`, `client_email`, `property_address`, `list_price`, `mls_number`, the response token (which gates the PATCH), and `agent_id`. The "secret" token model is broken — the policy says "select all rows," so the token never had to be guessed.

**Worse**, the `_anon_update` policy has no `WITH CHECK` clause. Anyone who has *any* valid token (e.g. the legitimate recipient) can PATCH *any other* non-expired row by primary key. They can mark another buyer's viewing as `decision='not_a_fit'`, set `offer_amount` to zero, or insert poisoned `client_note` content into the agent's UI.

**Recommended fix.** Replace both policies with token-scoped versions enforced via a SQL function:

```sql
DROP POLICY "viewing_responses_anon_select" ON viewing_responses;
DROP POLICY "viewing_responses_anon_update" ON viewing_responses;

-- SELECT only the row whose token was passed in a request-scoped GUC
CREATE POLICY "viewing_responses_token_select" ON viewing_responses
  FOR SELECT TO anon USING (
    token = current_setting('request.headers.x-response-token', true)
    AND expired = false
    AND expires_at > now()
  );

CREATE POLICY "viewing_responses_token_update" ON viewing_responses
  FOR UPDATE TO anon
  USING (
    token = current_setting('request.headers.x-response-token', true)
    AND expired = false
    AND expires_at > now()
    AND responded_at IS NULL
  )
  WITH CHECK (token = current_setting('request.headers.x-response-token', true));
```

Then have `respond.html` send `x-response-token: <token>` on every request. Better still, move the lookup + write into a single edge function (`respond-submit`) that validates the token, applies a single-use guard, and writes through service-role.

**Effort:** M. **Touches:** 1 migration + `respond.html` (≈ 30 lines).

#### 1.1.2 P0 — `viewings` updatable by any anon holding *any* live token

[supabase/migrations/015_respond_page_fix.sql:54](supabase/migrations/015_respond_page_fix.sql)
```sql
CREATE POLICY "viewings_anon_client_response" ON viewings
  FOR UPDATE USING (
    id IN (SELECT viewing_id FROM viewing_responses
           WHERE expired = false AND expires_at > now())
  );
```

The subquery scopes to viewings *that have* a live response token, but **doesn't restrict which row, which columns, or to which agent**. Any anon caller can UPDATE any viewing row across any agent, on any field (`viewing_status`, `agent_notes`, `cc_email`, …) — as long as there's at least one open response token somewhere in the table.

**Fix.** Same shape as 1.1.1 — pin the policy to `viewing_responses.token = current_setting(...)` so each viewing can only be updated by its own token holder, and add a `WITH CHECK` that whitelists only the columns the respond page legitimately changes (`client_response`, `client_feedback`, `offer_amount`). Better still, route the entire write through a SECURITY DEFINER RPC and remove anon UPDATE on `viewings` entirely.

**Effort:** M.

#### 1.1.3 P1 — `pending_offers` accepts unauthenticated INSERT with any `agent_id`

[supabase/migrations/015_respond_page_fix.sql:92](supabase/migrations/015_respond_page_fix.sql)
```sql
CREATE POLICY "pending_offers_anon_insert" ON pending_offers
  FOR INSERT WITH CHECK (true);
```

`respond.html` writes to `pending_offers` when a client picks "Make an Offer". The `WITH CHECK (true)` means an attacker can POST arbitrary rows targeting Maxwell's `agent_id` with attacker-controlled `client_name`, `property_address`, `client_note`, `offer_amount`. Two consequences:

- **UX/operational DoS.** Spam fake "🏠 New Offer Request" push notifications to Maxwell's phone via the realtime subscribe in [app.js:406](js/app.js).
- **Stored XSS surface** (combined with 1.4): `client_name` is rendered unescaped in Pending Offers banners and approval queue summaries.

**Fix.** Constrain insert to come from a valid `viewing_response` row (via the same SECURITY DEFINER RPC), or require the token to be supplied and verified server-side.

**Effort:** S inside the same RPC refactor.

#### 1.1.4 P1 — `client_intake` insertable by anyone, readable by any authenticated user

[supabase/migrations/007_security_rls_hardening.sql:74](supabase/migrations/007_security_rls_hardening.sql)
```sql
CREATE POLICY "intake_insert_public" ON client_intake
  FOR INSERT WITH CHECK (true);
CREATE POLICY "intake_read_own" ON client_intake
  FOR SELECT USING (auth.uid() IS NOT NULL);
```

- **Insert side.** Honeypot + 3-second timer in [intake.html:583](intake.html) is paper-thin. Any motivated bot bypasses both. At minimum, add Cloudflare Turnstile or hCaptcha invisible mode, plus a per-IP rate limit (edge function intermediary).
- **Read side.** `USING (auth.uid() IS NOT NULL)` means **any authenticated user**, not "any agent who owns the row." The moment a second agent is provisioned, they see every other agent's leads. The repo is positioning itself as a multi-brokerage product (see `dealflow-system-overview.html`) — this policy must be scoped to `agent_id` *now*.

**Fix.** Add an `agent_id` column to `client_intake` (populated server-side when the intake link includes an agent slug), then:
```sql
CREATE POLICY "intake_read_own" ON client_intake
  FOR SELECT USING (agent_id = auth.uid());
```

**Effort:** M.

#### 1.1.5 P1 — `disclosures`, `client_contacts`, `deal_documents` RLS not re-verified

Migrations 032, 033, 038 add these tables but I have not opened their RLS sections in full. Several use the pattern `auth.uid() = agent_id` (the seller-side migration mirrors it), but please confirm with:

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename, cmd;
```

**Effort:** S (verification only).

---

### 1.2 Anon-key duplication across public pages

The Supabase anon key is duplicated verbatim in **4 separate HTML files** instead of being loaded from `config.js`:

| File | Line |
|---|---|
| [config.js:3](config.js) | (source of truth) |
| [respond.html:196](respond.html) | duplicate |
| [intake.html:501](intake.html) | duplicate |
| [seller-intake.html:434](seller-intake.html) | duplicate |
| [build.html:201](build.html) | duplicate |

**Severity: P2.** The anon key is, by design, public — duplication is not itself a security issue. But it does become a problem the day the project rotates the key (e.g. responding to abuse, or rotating because the schema changed). Five copies, four of them easy to forget. Reference `config.js` from each public page.

**Effort:** S.

### 1.3 Service-role key usage — confirmed clean

Greppable across the codebase ([Bash check](#)): the string `service_role` appears in zero browser-loadable files and only in `supabase/functions/*` index.ts files. Good. The risk surface here is limited to edge-function code review.

### 1.4 XSS surface inventory

`App.esc` ([js/app.js:1049](js/app.js)) is the project's only HTML-escape helper:

```js
esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

**It does not escape single quotes (`'`) or backticks (`` ` ``).** This breaks the moment user-controlled data lands inside a single-quoted JS string in an HTML attribute, which the codebase does pervasively.

#### 1.4.1 P0 — JS injection via `App.esc(name)` in `onclick` attributes

Pattern (10+ occurrences in `clients.js` alone):

[js/clients.js:143](js/clients.js)
```js
onclick="event.stopPropagation();Clients.restore('${c.id}','${App.esc(c.full_name)}')"
```

If `c.full_name` is `O'Brien` the handler is silently broken (apostrophe terminates the JS string). If `c.full_name` is `');alert('xss');//` and was inserted via the **unauthenticated** intake form ([§1.1.4](#114-p1--client_intake-insertable-by-anyone-readable-by-any-authenticated-user)), then loaded into the agent's dashboard, the JS executes in the authenticated session.

Concrete file:line list of vulnerable handlers:
- [js/clients.js:143](js/clients.js), :144, :171, :172, :326, :327, :399, :515
- [js/offers.js](js/offers.js) — multiple (the file is 5,200 lines; full enumeration is part of the fix PR)
- [js/extras.js](js/extras.js) — 80 `innerHTML` assignments, many with the same pattern
- [js/reviews.js](js/reviews.js), [js/notifications.js](js/notifications.js), [js/tracker.js](js/tracker.js) — likely same pattern; not exhaustively scanned

**Fix.** Two-line patch to `App.esc`:
```js
esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
}
```

The proper long-term fix is to stop building HTML with template literals and either (a) use a tiny `html` tagged-template helper that auto-escapes interpolations, or (b) build DOM with `document.createElement` for any branch that consumes user data. Three of the largest files (`extras.js`, `offers.js`, `notifications.js` 80+ `innerHTML` calls combined) will keep producing new XSS holes until the pattern changes.

**Effort:** S (escape patch) + L (refactor to a tagged-template helper across modules).

#### 1.4.2 P1 — Unescaped interpolations in the bell panel and Pipeline snapshot

[js/app.js:583](js/app.js)
```js
el.innerHTML = items.map(item => `
  <div class="notif-item">
    ...
    <div class="notif-item-text">${item.text}</div>`
```

`item.text` is built from `clients.full_name` + `property_address` — both of which can be attacker-controlled via the intake/respond/pending_offers anon-insert paths.

[js/app.js:881](js/app.js) — same shape on `recent-activity` ➜ `${a.description}` from `activity_log`.
[js/app.js:913](js/app.js) — `📍 ${d.property_address || '—'}` in the Pipeline snapshot card.

**Fix.** Wrap every interpolation with `App.esc(...)`. There is no legitimate value in this codebase that should arrive in the DOM as raw HTML.

**Effort:** S.

#### 1.4.3 P1 — Fragile JSON-in-attribute encoding

[js/viewings.js:306](js/viewings.js)
```js
onclick="...Viewings._showForm(...,${JSON.stringify(v).replace(/"/g,'&quot;')})..."
```

Encoding JSON inside an HTML attribute by replacing only `"` with `&quot;` ignores `<`, `>`, `&`, single-quote, and the close-tag sequence inside string values. If `v.agent_notes` contains `</button>` the rest of the DOM breaks. Also a stored-XSS vector since `agent_notes` could be propagated from intake content depending on flow.

**Fix.** Don't shove JSON into attributes — store the viewing in a module-scoped cache keyed by `v.id` and have the handler look it up.

**Effort:** S.

#### 1.4.4 P1 — Token-auth pages render user-supplied data into innerHTML

`respond.html` and `intake.html` are simpler — they don't have an authenticated session to abuse — but they do render `rec.client_name`, `rec.property_address` via `textContent`, which is safe. `seller-intake.html` should be re-scanned in the same pass.

**Effort:** S (verification).

---

### 1.5 Token-auth public pages

#### 1.5.1 P1 — Token replay window

`respond.html` ([respond.html:255](respond.html)) marks the row `responded_at:..., expired:true` only after a successful PATCH. If an attacker intercepts a token (referer leak, mis-forwarded email, browser cache on a shared device), they have until the *real* recipient submits to race them. Since clients click these from email and may take days, the race window is wide.

**Fix.** Move the PATCH+INSERT pair into a single SECURITY DEFINER RPC that atomically:
1. Verifies `token`, not expired, `responded_at IS NULL`.
2. Marks `responded_at = now(), expired = true` *before* any branching logic.
3. Performs the `pending_offers` insert if applicable.

Returns the new state to the client. The replay window collapses to the duration of one RPC.

**Effort:** M.

#### 1.5.2 P2 — Token scope is implicit, not enforced

A token grants access to one viewing's response flow, but the policy as written ([§1.1.1](#111-p0--viewing_responses-is-world-readable)) doesn't bind the token to a specific viewing — it just hands out the whole table. After fixing §1.1.1, the scope is naturally per-row, which is correct.

#### 1.5.3 P2 — Tokens are 36-char UUIDv4

Acceptable entropy (122 bits). No fix needed.

#### 1.5.4 P1 — No revocation path from the agent UI

If Maxwell knows a client's link was forwarded to a wrong person, there is no "expire this token" button. He can `manualOverride` ([js/viewings.js:451](js/viewings.js)), which does flip `expired=true` on the response — but only after he's recorded a decision. A "revoke link" affordance on the viewing detail screen would be a small UX win.

**Effort:** S.

---

### 1.6 Edge function review

| Function | Auth | Rate limit | Service-role | Notes |
|---|---|---|---|---|
| `send-email` | ✅ Bearer + system shortcut | ✅ DB-backed (60/hr/agent) | ✅ | Solid. Two minor nits below. |
| `claude-chat` | ✅ Bearer | ❌ none | ❌ uses anon for user lookup | Token costs at risk. Add per-user/min cap. |
| `send-push` | **❌ no auth** | ❌ none | ❌ | **P1 — see 1.6.1** |
| `daily-briefing` | service-role only (cron) | n/a | ✅ | Hardcoded personal data. P1. |
| `daily-automation` | service-role only | n/a | ✅ | OK pattern. |
| `morning-briefing` | service-role only | n/a | ✅ | Duplicates daily-briefing — possibly dead. |
| `check-followups` | service-role only | n/a | ✅ | OK. |
| `backup-data` | ? | n/a | ✅ | Verify trigger source (cron expected). |
| `fetch-inbox` | ? | n/a | ? | Not reviewed in this pass. |

#### 1.6.1 P1 — `send-push` accepts unauthenticated requests

[supabase/functions/send-push/index.ts:205](supabase/functions/send-push/index.ts) → `serve(async (req) => { ... const { title, body, tab, subscriptions } = await req.json() ... })`.

No `Authorization` header check, no caller validation. The function will dispatch Web Push to any list of subscription objects sent in the body. Three risks:

- **Spoofed alerts to Maxwell's device.** An attacker who has scraped one of Maxwell's `push_subscriptions` rows (currently protected by RLS, so this requires a separate breach) can send him arbitrary "🚨 Pipeline error" notifications.
- **Free push relay.** Anyone can hit the function with their own (or someone else's) subscription endpoints. Bandwidth + cost on Maxwell's Supabase project.
- **No rate limit.** Tied to the above.

**Fix.** Add the same Bearer-token check as `claude-chat` ([supabase/functions/claude-chat/index.ts:36](supabase/functions/claude-chat/index.ts)), then look up the calling user's subscriptions server-side instead of trusting the body. The browser doesn't need to send the subscription list at all — it just needs to send `{title, body, tab}`.

**Effort:** S.

#### 1.6.2 P1 — `claude-chat` has no per-user rate limit

[supabase/functions/claude-chat/index.ts:62](supabase/functions/claude-chat/index.ts) forwards every authenticated message to Anthropic with `max_tokens: 1500`. One compromised agent session = unbounded Anthropic spend. Add the same `email_rate_limit`-style counter (10/min, 200/day per agent feels right for an "Ask AI" chat).

**Effort:** S.

#### 1.6.3 P1 — `daily-briefing` ships Maxwell's personal financial data in source

[supabase/functions/daily-briefing/index.ts:30-50](supabase/functions/daily-briefing/index.ts)
```ts
const PROFILE = {
  email: 'maxwelldelali22@gmail.com',
  monthly_income: 4200,
  monthly_fixed_costs: 3060,
  monthly_savings_now: 1140,
  upcoming_cash: [{ date: '2026-05-17', amount: 9000, ... }],
  ...
};
```

The repo is public-ish (it ships to Vercel and the build is observable). Personal income, savings, future commission amounts and dates should not live in source. Move to a `agent_briefing_settings` table keyed by `agent_id`.

**Effort:** M.

#### 1.6.4 P1 — Hardcoded recipient address blocks multi-agent

Same file. `email: 'maxwelldelali22@gmail.com'` is hardcoded. Also appears in `morning-briefing` and (per the earlier audit) `backup-data`. Move to `agent_briefing_settings` or an `agents.briefing_recipient` column.

**Effort:** S.

#### 1.6.5 P2 — Gmail refresh token rotation strategy is undocumented

`GMAIL_REFRESH_TOKEN` is a long-lived Supabase secret. If it leaks (Vercel build log, accidental commit, departed contractor), the attacker can send "from Maxwell" indefinitely. There is no rotation runbook in the repo. Add `SECRETS.md` to `docs/` covering rotation steps.

**Effort:** S (doc only).

#### 1.6.6 P2 — CORS `Access-Control-Allow-Origin: *` on every edge function

Every function returns `*`. Fine for development. For production, lock to the deployed origins (`https://maxwell-dealflow.vercel.app`, plus the future `https://app.maxwell-dealflow.com` and `https://marketing.maxwell-dealflow.com`). The respond/portal/intake pages all load from the same origin so this won't break anything.

**Effort:** S.

#### 1.6.7 P2 — Edge functions accept unbounded JSON payloads

None of the functions check `Content-Length` or bound `attachments[].data` size. A 30 MB base64 attachment will be parsed in-process. Add a 10 MB ceiling early in the handler.

**Effort:** S.

#### 1.6.8 P2 — `morning-briefing` and `daily-briefing` likely overlap

23 KB vs. 69 KB. The newer one (daily-briefing) appears to be the v2 and has the personalised audio/podcast feature. Confirm `morning-briefing` is unscheduled, then delete.

**Effort:** S.

---

### 1.7 Browser-side storage hygiene

| Key | Where | Sensitive? | Notes |
|---|---|---|---|
| `df-theme` | localStorage | no | OK |
| `mdf-sb-groups` | localStorage | no | OK |
| `mdf-profile-cache` | localStorage | yes (name/brokerage) | small leak; OK |
| `mdf-agent-photo` | localStorage (base64) | yes (face) | mild; OK |
| `df-buyer-intake-submitted` | localStorage | no | submit-once flag |
| `mdf-login-lock`, `mdf-login-attempts` | localStorage | **false sense of security** | **P1 — see 1.7.1** |
| Supabase session | localStorage (via SDK) | yes — JWT | OK — same as every Supabase app |

#### 1.7.1 P1 — Login brute-force "protection" is client-side

[js/app.js:142](js/app.js) tracks failed attempts in localStorage and "locks" the account for 15 minutes after 5 fails. Clearing site data, opening incognito, switching browsers, or hitting the Supabase REST endpoint directly all bypass this in seconds.

The actual brute-force defence has to be:
1. Supabase Auth's built-in throttling (already present per-IP), confirm it's enabled.
2. A `failed_logins` table backed by Supabase RPC that *the server* checks.

Remove the localStorage lockout and replace with a clear "Too many attempts — try again in N minutes" message driven by the server response.

**Effort:** M.

### 1.8 Vercel `headers` posture

[vercel.json:21](vercel.json) sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. Missing for a payment-adjacent CRM:

- **`Strict-Transport-Security`** — P1. `max-age=63072000; includeSubDomains; preload`
- **`Content-Security-Policy`** — P1, but blocked by current pattern of inline event handlers (`onclick="…"` × thousands of times). Realistic minimum: `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co; img-src 'self' data: https://images.unsplash.com https://*.supabase.co; connect-src 'self' https://*.supabase.co https://api.anthropic.com; font-src 'self'; frame-ancestors 'none';`
- **`Permissions-Policy`** — P2. Disable `geolocation`, `microphone`, `camera`, `usb` since none are used.
- **`Cross-Origin-Opener-Policy: same-origin`** + **`Cross-Origin-Resource-Policy: same-origin`** — P2.

**Effort:** S (header additions). The CSP can be a separate PR once inline handlers are reduced.

### 1.9 PII in the `viewing_responses` and `pending_offers` tables

Both contain `client_email`, `client_name`, `property_address`, `list_price`. After fixing §1.1, also consider:

- Setting a hard 60-day TTL with a nightly cleanup cron (the email_rate_limit cleanup pattern is the template).
- Encrypting `client_email` at rest? Probably overkill until you have a privacy regulator looking — PIPEDA's reasonable-care bar is met by RLS, TLS, and limited retention.

**Effort:** S (TTL cleanup).

---

## 2. Production readiness

### 2.1 Bundle weight and load order

`index.html` ships **20 blocking `<script>` tags** in document order:

```
@supabase/supabase-js   ─ 90 KB ─ CDN
chart.js                 ─ 200 KB ─ CDN  ← only used on Analytics tab
html2pdf.bundle          ─ 250 KB ─ CDN  ← only used to export offer PDF
config.js
app.js                   ─ 50 KB
clients.js               ─ 27 KB
viewings.js              ─ 40 KB
offers.js                ─ 210 KB     ← junk drawer
notifications.js         ─ 102 KB    ← email templates
pendingoffers.js         ─ 4 KB
responses.js             ─ 13 KB
extras.js                ─ 259 KB    ← largest file in the repo
disclosure.js            ─ 12 KB
analytics.js             ─ 22 KB
portal-traffic.js        ─ 15 KB
tracker.js               ─ 9 KB
ai.js                    ─ 14 KB
calendar.js              ─ 12 KB
reviews.js               ─ 34 KB
briefing.js              ─ 14 KB
```

**Raw total: ~1.4 MB uncompressed JS** before the app shows a single pixel. Gzipped: ~350 KB. On a 4G phone this is a 2-3s TTFB→FCP penalty.

#### 2.1.1 P1 — Tag every `<script>` with `defer`

The fastest low-risk win. Move every `<script src="js/...">` to `defer` and place them in `<head>`. Order is preserved, but they download in parallel and execute after the DOM. Expected LCP improvement: 30-40% on cold-load mobile.

**Effort:** S.

#### 2.1.2 P1 — Lazy-load Chart.js, html2pdf, analytics.js, briefing.js

These are required by exactly one tab each. They have no business loading on the lock screen. Dynamic `import()` from inside `App.switchTab('analytics')` etc.

**Effort:** M.

#### 2.1.3 P1 — Split `extras.js` (259 KB, 3,700+ lines)

It is a holding cell for Approvals, Inbox, Reports, Commissions, Broadcast, EmailSend, Settings, Cleanup, SystemTools, NewBuilds linker, AgentPortal, FormResponses. Each is its own module's worth of code. The old audit recommended a 4-file split; my version:

- `js/approvals.js` (Approvals + EmailSend)
- `js/inbox.js` (Inbox + Broadcast)
- `js/reports.js` (Reports + Commission + ActivityLog + FormResponses + AgentPortal)
- `js/system.js` (Settings + SystemTools + Cleanup)

This is the second-biggest unblock in the codebase. Every future change to any of these submodules is currently risky because a typo in one section can break four others.

**Effort:** L.

#### 2.1.4 P1 — `offers.js` (210 KB) carries Pipeline, Transaction Room, PDF Export

Split:
- `js/offers.js` keep — Offers + Requests
- `js/pipeline.js` — Pipeline + TransactionRoom + Checklist
- `js/offer-pdf.js` — PDF export (lazy)

**Effort:** L.

#### 2.1.5 P2 — `notifications.js` (102 KB) is mostly inline HTML email templates

Each template is ~100 lines of HTML in a JS string. Pulling templates into `js/email-templates/*.js` files that lazy-load on first use would cut the warm path by ~70 KB.

**Effort:** M.

### 2.2 Service worker

[sw.js](sw.js) — 102 lines, network-first for everything-not-icons, cache-first for icons.

#### 2.2.1 P1 — Stale-cache contamination

The active cache version is `dealflow-v71`. There is no eviction on stale entries, no `Vary` handling, and `?v=` query strings are not stripped. After every deploy the cache silently grows. On constrained iPhones this is a measurable user-storage hit over months.

**Fix.** Add a max-age sweep on `activate`:
```js
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== ICON_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
));
```
…which exists. But it only purges *old caches*, not stale entries inside the current one. Add an LRU-style trim of `CACHE` entries older than 30 days.

**Effort:** S.

#### 2.2.2 P1 — Network-first is the wrong default for a PWA shell

For an installed PWA, the user expects "open the app and see something *now*, then update." Cache-first with stale-while-revalidate for `index.html`, `app.css`, `manifest.json`, and `/js/*.js` would give Maxwell an instant cold-open on subway WiFi. The "always fresh code" guarantee in the current strategy is what causes the slow first paint on bad networks.

**Effort:** S.

#### 2.2.3 P2 — `caches.match('/index.html')` offline fallback

OK pattern, but with the current rewrite (`/(.*) → /index.html`) the offline fallback could miss for deep links like `/portal?t=...`. Verify.

#### 2.2.4 P2 — `skipWaiting`/`clients.claim` causes mid-session reloads

Calling `skipWaiting()` on every install means a freshly deployed SW takes over while the user has the app open. Combined with the network-first strategy, the next navigation pulls new JS that may not match the old HTML cached in the page. Add a `controllerchange` listener that prompts before reload, or scope `skipWaiting` to fresh installs.

**Effort:** S.

### 2.3 Error visibility

There is none. Searching the codebase:
- No Sentry / Bugsnag / Rollbar import.
- No PostHog or LogRocket.
- No Supabase log table that the app writes errors to.
- Console-only: `console.warn`, `console.log` (production code).

**Recommendation (P1).** Use Supabase's built-in `pg_log` table + a `client_errors` table:

```sql
CREATE TABLE client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES auth.users(id),
  url text,
  user_agent text,
  message text,
  stack text,
  context jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE client_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_errors_insert" ON client_errors
  FOR INSERT TO authenticated WITH CHECK (agent_id = auth.uid());
```

Hook in a `window.onerror` + `window.onunhandledrejection` handler in `app.js`. Free, no third-party, surfaces with a single `select * from client_errors order by created_at desc`.

If/when DealFlow opens to more brokerages, switch to Sentry (free for ≤5K events/mo) — but only after a CSP is enforceable, since Sentry's loader uses inline script otherwise.

**Effort:** M.

### 2.4 Supabase query performance

Spot checks:

- [js/app.js:706](js/app.js) `loadOverview` runs **9 parallel queries**. Six are `count:'exact',head:true` (cheap). Three return rows: 60 clients, 6 activity rows, 3 deals. Good.
- [js/app.js:540](js/app.js) `loadNotifications` runs **4 parallel queries**, all with `select *`. The `viewings` queries use `select('*, clients(full_name)')` then read only `clients.full_name` and a handful of viewing fields. Narrow the selects.
- [js/clients.js:12](js/clients.js) Pulls **every viewing, every offer, every pipeline row** for the agent to derive the "true stage" client-side. Two issues: (a) it's O(N×M) on the client when one SQL join with `LATERAL` would do it in the DB, (b) `select('*')` shouldn't be the default — name the columns.
- [js/viewings.js:8](js/viewings.js) `limit(100)` — OK, but the UI doesn't paginate. After a year of use it'll start dropping the oldest viewings silently.

**Effort:** M (per file). **Severity: P2** in all cases — performance is acceptable today and there's no correctness issue.

### 2.5 PWA install path

- `manifest.json` is clean and well-formed.
- `display_override: ["window-controls-overlay", ...]` is set without supporting CSS — minor cosmetic only on desktop installs.
- No `screenshots: [...]` declared — the install dialog on Android/desktop is uglier than it needs to be.
- PWA install banner ([js/app.js:11](js/app.js)) is a bespoke `position:fixed` overlay, not styled with the rest of the app. Cosmetic.

**Effort:** S (screenshots + banner restyle).

### 2.6 Lighthouse + Web Vitals — deferred

I cannot run Lighthouse against the deployed URL from this sandbox. To unblock Phase 2, run from your machine:

```bash
npx lighthouse https://maxwell-dealflow.vercel.app/ \
  --preset=desktop --output=html --output-path=./lh-desktop.html
npx lighthouse https://maxwell-dealflow.vercel.app/ \
  --emulated-form-factor=mobile --output=html --output-path=./lh-mobile.html
# Per-page:
for path in / /respond /portal /intake ; do
  npx lighthouse "https://maxwell-dealflow.vercel.app$path" \
    --emulated-form-factor=mobile --quiet --chrome-flags="--headless" \
    --output=json --output-path="./lh${path//\//-}.json"
done
```

**Predicted scores based on static analysis:**

| Page | Performance | Accessibility | Best Practices | SEO | PWA |
|---|---|---|---|---|---|
| `/` (agent app) | 35-50 (bundle weight, no defer) | 60-70 (no ARIA, low contrast on muted greys) | 75-85 | 60 (no meta-desc relevance) | 80-90 |
| `/respond` | 80-90 | 70 | 90 | n/a | n/a |
| `/portal` (→ stakeholder) | 85-95 | 75 | 90 | n/a | n/a |
| `/intake` | 75-85 | 70 (form labels via span, not `<label>`) | 90 | n/a | n/a |

Real values will land lower than my predictions on cold-cache mobile. Use the JSON outputs to drive Phase 2.

---

## 3. Code quality

### 3.1 Dead code & legacy artifacts

| File | Status | Recommendation |
|---|---|---|
| `js/pendingoffers.js` (83 lines) | live | Merge into `offers.js`. |
| `js/stakeholder-portal.js` (236 lines, v1) | replaced | `stakeholder.html` loads v2. Delete v1. |
| `js/responses.js` (336 lines) | overlaps with viewing_responses flow | Audit before deleting. |
| `build.html`, `js/builder-portal.js` | unclear if live | The new-builds flow exists separately. Confirm. |
| `builder.html`, `builder-v2-B*.html`, `stakeholder-v2-*.html` | drafts at repo root | Move to `_drafts/` or delete. |
| `refined/` directory | unclear purpose | Audit. |
| `meridian_*.{pdf,svg,docx}`, `Maxwell_DealFlow_Visual_Guide*.{html,pdf,pptx}` (~25 MB) | stale docs | Move to `_archive/` or delete. |
| `Settings.loadSavedPhoto()` | referenced before defined | Investigate (timing race). |
| Intake honeypot fields | low value | Keep until CAPTCHA, then remove. |
| `client_responses` table | replaced by `viewing_responses` | Drop in next migration. |
| `.sb-footer-btn`, `.sb-server-info` CSS | display:none ghost | Remove from `app.css`. |

**Effort to action all of the above:** M.

### 3.2 Date formatting consistency

`App.fmtDate` ([js/app.js:1025](js/app.js)) is the canonical formatter. Greppable usage shows 39 callsites use it, but several modules construct dates manually with `toLocaleDateString` directly:

- [js/app.js:737](js/app.js), :1091, :1092 — hero greeting + lock-clock, OK in context
- [js/calendar.js:181](js/calendar.js), :233 — calendar headers (long format, intentional)
- [js/clients.js](js/clients.js) — uses `App.fmtDate`. Good.
- [js/notifications.js](js/notifications.js) — email templates likely have their own date format. Verify.

**Recommendation.** Add `App.fmtDateLong(d)` and `App.fmtDateRel(d)` (today/tomorrow/yesterday/Mon Jun 3) so every consumer can pick the right one without dropping back to `toLocaleDateString`.

**Effort:** S.

### 3.3 Module hygiene — globals on `window`

Every module is implicitly `window.X = const X = { ... }`. There are 23+ such globals. Order in `index.html` matters; a typo in one file (`Notify.que()` instead of `Notify.queue()`) silently breaks 11 callsites.

**Recommendation.** Wrap each module in an IIFE that registers on a single `window.DF` namespace:
```js
window.DF = window.DF || {};
DF.Clients = (() => { ... return { load, render, ... }; })();
```
Then introduce `<script type="module">` once `index.html` is small enough to defer everything.

This pairs with §2.1's split — bigger lift but enormous payoff.

**Effort:** L.

### 3.4 Magic numbers and hardcoded strings

- `5 * 60 * 1000` for "every 5 minutes" appears in [js/app.js:232](js/app.js), :236, :246, :257. Constant it once.
- Brokerage fallback string `'eXp Realty'` appears in [app.js:208](js/app.js), :213, multiple places in `notifications.js`. Move to `App.AGENT.BROKERAGE`.
- Phone `(709) 325-0545`, email `Maxwell.Midodzi@exprealty.com` are hardcoded in `respond.html`, `intake.html`, `portal.html`, `notifications.js` templates. Move to `config.js` agent profile.
- `14 * 24 * 60 * 60 * 1000` (14-day expiry) appears in `viewings.js` and is documented in the response page. Constant: `TOKEN_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000`.

**Effort:** S.

### 3.5 The `onSignedIn` setTimeout cascade

[js/app.js:184](js/app.js) → 13 deferred operations with delays from 400ms to 7000ms:

```
Notify.checkConditionDeadlines()         @ +2000ms
Notify.checkCompletedViewings()          @ +2500ms (+5min interval)
PendingOffers.load()                     @ +3000ms (+5min interval)
Notify.updateBadge()                     @ +1500ms
App.loadNotifications()                  @ +2200ms
Responses.updateBadge()                  @ +1800ms
Inbox.updateBadge()                      @ +2000ms
Inbox.syncGmail(true)                    @ +5min interval
App.requestNotifyPermission()            @ +3000ms
App.checkNewIntakes()                    @ +4000ms
App.checkNewRequests()                   @ +4500ms
App.subscribeToRequests()                @ +5000ms
Offers.checkFollowUps()                  @ +6000ms (+5min interval)
Notify.checkInactiveClients(7)           @ +7000ms (+6hr interval)
```

This is fragile. On a slow phone the user can tap into Approvals before `Approvals.load()` has run, causing the empty state to flicker. On a fast desktop, badges flash 0→7→3→9 in 3 seconds.

**Fix.** Replace with a single `App.afterSignIn` event that fires once, plus per-tab lazy loads. Background polling should live in one place (`App.startBackgroundTasks()`) called *after* the initial paint.

**Effort:** M. **Severity: P1** (fragility under load).

### 3.6 Inline styles and inline event handlers

- **429 inline `style="..."` attributes in `index.html`.**
- 80+ inline-style template literals across the JS files.
- Every interactive element is wired via `onclick="..."`.

The CSS in `app.css` already defines `.card2`, `.pill2`, `.btn2 .btn2-primary`, etc. — the design system exists. Most inline styles are 1-2 properties that could be utility classes. The inline event handlers are what's blocking a proper Content-Security-Policy.

**Recommendation.** A two-pass refactor (Phase 2):
1. **Pass A — utility classes.** Add `.pad-12`, `.mt-8`, `.text-muted-12`, etc., and codemod the most common inline patterns. Aim: < 50 remaining inline `style="..."`.
2. **Pass B — event delegation.** Single `document.addEventListener('click', ...)` reading `data-action` attributes. Drop `onclick=`. Enables strict CSP.

**Effort:** L (each pass).

### 3.7 Mobile-first CSS

`css/app.css` has 10 `min-width` media queries and 14 `max-width` queries — predominantly desktop-first. For a phone-primary product this is backwards.

**Effort:** M (mechanical inversion + verification).

### 3.8 Light-mode colour semantics

[css/app.css:12](css/app.css):
```css
--green:#9CA3AF; --green-soft:rgba(156,163,175,0.14);
--yellow:#9CA3AF; --yellow-soft:rgba(156,163,175,0.14);
```

`--green` is grey. `--yellow` is grey. Throughout the JS, calls like `App.toast('✅ ...', 'var(--green)')` produce a grey toast border — which is presumably intentional ("muted palette"), but the variable names lie. Either rename to `--neutral` / `--neutral-soft` or restore the original semantic colours.

**Effort:** S (rename + sweep).

### 3.9 `alert()` and `confirm()` instead of in-app modals

Greppable: 64+ calls across `js/`. Native confirm dialogs feel cheap on iOS (system grey, no app context). The app has a perfectly good `App.openModal` infrastructure. Replace `confirm('Delete...?')` with a styled modal that returns a Promise.

**Effort:** M.

### 3.10 Logging

`console.log` / `console.warn` calls remain in shipped code (e.g. `js/app.js:309, :341`). Behind a `DEBUG` flag they're useful; in production they're noise. Wrap in `if (DEBUG)` or strip on build.

**Effort:** S.

---

## 4. Accessibility (WCAG 2.1 AA)

### 4.1 Contrast

Spot checks against the dark palette:
- `--text2:#94A3B8` on `--bg:#0A0E14` → contrast ratio ≈ 7.8:1. ✅
- `--text3:#64748B` on `--bg:#0A0E14` → contrast ratio ≈ 4.3:1. **Fails AA for body text** (needs 4.5:1), passes for "large text 18pt+".
- Status pills use accent colour text on accent-soft backgrounds — those at `0.14` opacity over the dark BG are around 4.0-4.5:1. Borderline.

Spot checks light mode:
- `--text2:#475569` on `--bg:#F8F7F4` → 7.2:1. ✅
- `--text3:#94A3B8` on `--bg:#F8F7F4` → 3.1:1. **Fails AA.**

**Fix.** Bump `--text3` to `#52617A` (dark) / `#7A8599` (light), and revisit pill foreground/background pairs.

**Effort:** S (palette tweaks) + spot QA.

### 4.2 Keyboard navigation

- The hamburger, theme toggle, notification bell, and AI button are real `<button>` elements — they're focusable and trigger on Enter/Space ✅.
- Many "clickable cards" use `<div onclick="…">` (e.g. [js/clients.js:109](js/clients.js) `client-row`, [js/calendar.js:132](js/calendar.js) `cal-cell`). These are **not keyboard-accessible**. Tab order skips them entirely. **P1.**
- Modal trap. `App.openModal` ([js/app.js:927](js/app.js)) does not move focus into the modal, does not trap focus, does not return focus on close. **P1.**
- Lock screen `Ctrl+L` shortcut hint is shown ([index.html:70](index.html)) but I couldn't find a listener registration — verify in the rest of `app.js`.

**Fix.**
1. Convert `client-row`, `cal-cell`, etc. to `<button>` or add `role="button" tabindex="0"` plus Enter/Space handlers.
2. Add a tiny focus-trap helper to `App.openModal` (~ 30 lines, no library).

**Effort:** M.

### 4.3 ARIA

- Zero `aria-live` regions. The toast (`#toast`) appears and disappears with no screen-reader announcement. **P1.**
- Modal overlay has no `role="dialog"` / `aria-modal="true"` / `aria-labelledby`. **P1.**
- Icon buttons (`.tb-icon-btn`, `.tb-hamburger`) mostly have `aria-label` ✅ — but the `.tb-bell-count` badge has no `aria-label` for "N unread".
- Pills (`.pill2-indigo` etc.) are decorative spans, not interactive — that's fine.

**Fix.**
- Wrap `#toast` in `role="status" aria-live="polite" aria-atomic="true"`.
- Add `role="dialog" aria-modal="true" aria-labelledby="modal-title"` to `#modal-overlay`.

**Effort:** S.

### 4.4 Form labels

- Agent app modals use `<label class="form-label">` inside `<div class="form-group">` — the labels are visually associated but **not programmatically associated** (no `for=` / `id=` pair). Screen readers will announce the inputs as unlabelled.
- `intake.html` uses `<span class="field-label">` instead of `<label>` — same issue. **P1.**

**Fix.** Add `for=` on every `<label>` and matching `id=` on inputs. For `<span class="field-label">` cases, change the tag to `<label>` with `for=`.

**Effort:** M.

### 4.5 Focus states

[css/app.css:43](css/app.css) — global `input,select,textarea{outline:none;}` strips focus rings everywhere. There's no `:focus-visible` rule to bring them back in `app.css`.

**Fix.** Add:
```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:focus-visible, a:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```
**Effort:** S.

### 4.6 Reduced-motion

`@media (prefers-reduced-motion: reduce)` does not appear in `app.css`. The lock-slide cross-fade and `cal-item.current` pulse will run for users who've opted out. **P2.**

**Effort:** S.

### 4.7 Screen-reader announcement of async events

- Toast (see 4.3) — silent.
- Push notification permission grant has no live-region update.
- Form errors (`#cf-status`, `#vf-msg`, `#auth-error`) update text but the elements are not `aria-live`. **P1.**

**Fix.** Add `aria-live="polite"` and `role="status"` to every status/error element.

**Effort:** S.

---

## 5. Testing

### 5.1 Current state

Zero. No `package.json`, no `vitest.config`, no `playwright.config`, no `tests/` directory, no GitHub Actions workflow. Greppable confirmation: no `*.test.*` / `*.spec.*` files.

### 5.2 Minimum credible setup

I'm not asking for full coverage. I am asking for three things:

#### 5.2.1 Three Vitest unit tests on the helpers that matter

Helpers chosen because they're called from many places, are pure functions, and have non-obvious branches:

- `App.fmtDate(d)` — handles `null`, `YYYY-MM-DD`, full timestamptz, invalid strings.
- `App.fmtMoney(n)` — handles `null`, `0`, decimals, large numbers (Canadian formatting).
- `App.esc(str)` — after fixing §1.4.1, lock the escape set in a test.

**File:** `tests/unit/app-helpers.test.js`. Install: `npm i -D vitest` (~ 6 MB dev-only).

#### 5.2.2 One Playwright smoke test for the golden path

```
1. Visit /
2. Sign in with test account credentials (env var)
3. Wait for #app to be visible
4. Click the Clients tab → assert list renders
5. Click the first client → assert detail modal opens
6. Close modal → click Viewings tab
7. Open the first viewing → assert "Mark Completed" button
```

Run on every PR via GitHub Actions, against Vercel preview deployment. Catches regressions in the sign-in → load → render path that the setTimeout cascade currently masks.

**File:** `tests/e2e/golden-path.spec.ts`. Install: `npm i -D @playwright/test` (~ 80 MB dev-only).

#### 5.2.3 One Playwright accessibility smoke

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('agent app has no critical a11y violations', async ({ page }) => {
  await page.goto('/');
  // ... sign in
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter(v => v.impact === 'critical');
  expect(critical).toEqual([]);
});
```

**Effort:** S each, M total (CI wiring is the bulk of the work).

---

## 6. Documentation

The repo has nine+ overlapping documents at root (Visual Guides, Blueprints, Compliance Reports, Handovers — many `.pdf`/`.pptx`/`.docx` weighing ~25 MB). The old `AUDIT.md` is comprehensive but dated April 2026.

Missing:
- `README.md` (P1) — there is none.
- `DEPLOY.md` (P1) — how to deploy/rollback Vercel + Supabase secrets.
- `SECRETS.md` (P1) — full inventory of secrets and rotation runbook (Gmail refresh token especially).
- `SETUP.md` (P2) — clone-to-running in 60 seconds.

**Effort:** M (writing only).

---

## 7. Triage table (sorted)

### P0 — fix before refining anything else

| # | Area | File | Effort |
|---|---|---|---|
| 1 | World-readable `viewing_responses` | [015_respond_page_fix.sql:39](supabase/migrations/015_respond_page_fix.sql) | M |
| 2 | World-writable `viewings` via any live token | [015_respond_page_fix.sql:54](supabase/migrations/015_respond_page_fix.sql) | M |
| 3 | JS injection via `App.esc` (no `'` escape) | [js/app.js:1049](js/app.js) | S |
| 4 | `client_intake` cross-agent readability | [007_security_rls_hardening.sql:74](supabase/migrations/007_security_rls_hardening.sql) | M |
| 5 | Unescaped `${item.text}` in bell & overview | [js/app.js:583](js/app.js), :881, :913 | S |

### P1 — fix before /site/ ships or new agents onboard

`send-push` unauth, `claude-chat` no rate limit, hardcoded financial data in `daily-briefing`, hardcoded recipient address, no observability, no `defer`, no lazy-load Chart/html2pdf, no `extras.js`/`offers.js` split, fragile setTimeout cascade, network-first SW, no HSTS/CSP/Permissions-Policy, no ARIA live regions, modal focus trap, programmatic form labels, async error a11y, `pending_offers` anon-insert, token-replay window, client-side login lockout, missing README/DEPLOY/SECRETS, mobile-first inversion. (24 items.)

### P2 — polish and hygiene

CORS hardening, edge fn body cap, Gmail token rotation doc, anon-key duplication in 4 HTML files, dead code removal, magic-number constants, ghost CSS, lock-screen Unsplash images, screenshots in manifest, `morning-briefing` likely dead, alert/confirm replacement, console.log strip, reduced-motion media query, focus-visible rules, contrast tweaks for `--text3`, palette colour-name semantics, supabase query select-trimming, calendar drag-to-create, viewing detail map embed, Cmd+K palette, AI streaming. (21 items.)

---

## 8. Recommended Phase 2 order (one PR per item)

Strictly enforced rule from the project brief: **one phase, one branch, one PR**.

1. `security/rls-respond-flow` — items P0 #1, #2, #4 (single migration + RPC).
2. `security/app-esc-and-xss-sweep` — items P0 #3, #5 + sweep of bell/activity/snapshot.
3. `security/send-push-auth` — item P1.
4. `security/ai-rate-limit` — item P1.
5. `perf/defer-scripts` — script defer tags + ordering.
6. `perf/lazy-third-party` — Chart/html2pdf/briefing dynamic imports.
7. `refactor/split-extras` — 4-file split, no behaviour change.
8. `refactor/split-offers-pipeline` — same.
9. `refactor/event-driven-signin` — kill setTimeout cascade.
10. `a11y/keyboard-and-aria` — modal trap, live regions, focus-visible, label binding.
11. `ui/mobile-first-css` — invert media queries, audit pill contrast.
12. `ui/client-list` (Phase 2 brief A) — refine, screenshot, before/after.
13. `ui/viewing-detail` — same pattern.
14. `ui/pipeline-kanban` — same.
15. `ui/calendar` — same.
16. `ui/command-palette` — Cmd+K.
17. `ui/ai-markdown-streaming` — same.
18. `obs/client-errors-table` — observability table + handler.
19. `docs/readme-deploy-secrets` — markdown.
20. `cleanup/dead-files-and-docs` — remove `_archive/`d items.

Then `/site/` (Phase 3) and `SITE_AUDIT.md` (Phase 4).

---

## 9. Things I deliberately did **not** audit in Phase 1

- Migration-by-migration sequential validity (the migrations are cleanly numbered and I assume have been applied in order — I'm trusting that, not verifying it).
- The Gmail OAuth consent screen / publish status.
- Whether `pg_cron` jobs are healthy (run `SELECT * FROM cron.job_run_details WHERE end_time > now() - interval '7 days' ORDER BY end_time DESC` to confirm).
- The actual contents of `js/extras.js` past §1.4's grep evidence. A full XSS sweep belongs in PR #2.
- `js/reviews.js`, `js/builder-portal.js`, `js/portal-traffic.js` security beyond surface checks.
- Performance of any single endpoint in the wild — needs Lighthouse + RUM (deferred per §2.6).
- Whether the lock-screen Unsplash URLs violate Maxwell's Unsplash usage rights (probably fine, but verify before /site/).

---

## 10. Approval request

Phase 1 is complete. **No code has changed.** I'm holding here until you sign off on:

1. **The P0 list and the order it goes in PR #1–#5.** If you want the unfound disclosures/client_contacts/deal_documents RLS checked *as part of* PR #1, say so.
2. **The Phase 2 sequencing.** 20 PRs feels right; if you want them collapsed or reordered, tell me.
3. **The testing minimum** (Vitest + Playwright + axe). If you'd rather defer testing until /site/ ships, that's a defensible choice — I'd just want it in writing.
4. **The observability path** — Supabase `client_errors` table now, Sentry later. Alternative: PostHog from day one. Your call.
5. **Are the doc cleanups (the 25 MB of stale PDFs/PPTX/DOCX) in scope?** If yes, I'll add a `cleanup/repo-hygiene` PR up front.

Once you ack, I begin Phase 2 with `security/rls-respond-flow` and stop again after the first PR for you to review.
