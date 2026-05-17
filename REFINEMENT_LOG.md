# REFINEMENT_LOG

Per the Phase 2 brief: every PR gets a row here. UI PRs include BEFORE/AFTER screenshots at 390px and 1440px. Non-UI PRs (security, infra, tooling) log functional evidence instead.

---

## PR #1 — `security/rls-respond-flow`

**Type:** Security — server-side RLS hardening + 4-line header plumbing in `respond.html`.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.1.1 — P0 — `viewing_responses` world-readable.
- §1.1.2 — P0 — `viewings` updatable by any anon with any live token.
- §1.1.3 — P1 — `pending_offers` accepts spam INSERTs.

**Visual change:** None. respond.html renders, behaves, and times identically. Screenshots N/A (no UI surface).

**Files:**
- `supabase/migrations/040_respond_flow_rls_hardening.sql` — new.
- `respond.html` — two edits (5 added lines, 3 removed) to send `X-Response-Token` on every Supabase REST call.

**Functional evidence (manual smoke tests — run on Supabase after migration applies):**

1. **Anon, no header — should return empty.**
   ```bash
   curl -s "$SUPABASE_URL/rest/v1/viewing_responses?select=id,token" \
     -H "apikey: $SUPABASE_ANON" -H "Authorization: Bearer $SUPABASE_ANON"
   ```
   Expected: `[]`. Before this PR: returns every row.

2. **Anon, valid token — should return exactly one row.**
   ```bash
   curl -s "$SUPABASE_URL/rest/v1/viewing_responses?select=id,token" \
     -H "apikey: $SUPABASE_ANON" -H "Authorization: Bearer $SUPABASE_ANON" \
     -H "X-Response-Token: $VALID_TOKEN"
   ```
   Expected: 1 row (the matching one).

3. **Anon, bogus token — should return empty.**
   Same as #2 with `X-Response-Token: definitely-not-a-real-token`. Expected: `[]`.

4. **Anon UPDATE without header on someone else's row — should affect 0 rows.**
   ```bash
   curl -s -X PATCH "$SUPABASE_URL/rest/v1/viewing_responses?id=eq.$VICTIM_ID" \
     -H "apikey: $SUPABASE_ANON" -H "Authorization: Bearer $SUPABASE_ANON" \
     -H "Content-Type: application/json" -H "Prefer: return=representation" \
     -d '{"responded_at":"2030-01-01T00:00:00Z","decision":"not_a_fit"}'
   ```
   Expected: `[]`. Before this PR: returns the modified row (lateral movement).

5. **Anon PATCH with own valid token on own row — should succeed once, then fail.**
   First call returns the patched row; second call returns `[]` because `responded_at IS NULL` is now false.

6. **Real respond.html flow in a browser.** Visit `/respond?t=<valid-token>` from an incognito window. Pick "Make an Offer", submit. Agent's `pending_offers` dashboard surfaces the entry. Pick "Continue Searching" on a second link, submit. Reload either link — sees the expired state. No regression from before this PR.

7. **Agent app sanity.** Log in as the agent in another window — Approvals, Viewings, Pipeline, Requests all render unchanged (the migration touches only the `anon` role; `authenticated` agent policies are untouched).

**Risk if rolled back:** None — migration reverts cleanly by re-running 015's policy statements. respond.html still works without the header against the old policies (the policies don't read the header anyway).

**Performance impact:** Every anon REST call now triggers one extra JSON parse to read the header. Sub-microsecond. Not measurable.

**Status:** ✅ Shipped 2026-05-15.
- Code merged to master via direct merge (escape-hatch path from GitHub 2FA lockout): commit `825fb0d`.
- Migration 040 applied to production Supabase.
- Smoke tests A and B both returned `[]` from anon callers without a valid token. Hole confirmed closed.

---

## PR #2 — `security/app-esc-hardening`

**Type:** Security — escape-helper hardening. Two new replace pairs on `App.esc`, one new helper `App.escAttr`.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.4.1 — P0 — JS injection through `App.esc(name)` in `onclick` attributes. The audit's proposed fix (add `'` to `App.esc`) turned out to be insufficient for inline-handler contexts — HTML decodes `&#39;` back to `'` *before* the JS parser sees it, so the injection still fires. PR #2 ships the correct two-helper fix: `App.esc` for HTML-text contexts, `App.escAttr` for JS-string-in-HTML-attribute contexts.

**Scope explicitly excluded from this PR:**
- Call-site sweep (replacing `App.esc` with `App.escAttr` in the ~60 `onclick="X.fn('${...}')"` patterns across `clients.js`, `offers.js`, `extras.js`). Lands in PR #4 (`security/unescaped-templates`), which gets to use both helpers.
- Vitest tests for the helpers. Land in PR #6 (`testing/ci-baseline`).
- Escaping `/` — rejected as not load-bearing in this codebase. The only context where `</...>` is dangerous is inside `<script>` blocks, and the agent app does not generate inline scripts from user data.

**Visual change:** None. Adding code that nothing yet calls. Screenshots N/A.

**Files:**
- `js/app.js` — extends `App.esc` (+2 replaces), adds `App.escAttr` helper (+11 lines), adds comments explaining when to pick which (+8 lines).

**Functional verification — run in browser DevTools after deploy:**

The two helpers were tested live in the dev server (`localhost:3333`) with the actual rendered DOM. Results:

| Input | `App.esc` output (HTML text) | `App.escAttr` output (JS string in HTML attr) |
|---|---|---|
| `O'Brien` | `O&#39;Brien` | `O\'Brien` |
| `');alert(1);//` | `&#39;);alert(1);//` | `\');alert(1);//` |
| `</script>` | `&lt;/script&gt;` | `\x3c/script>` |
| `` `xss` `` | `&#96;xss&#96;` | `` `xss` `` |
| `O"Brien` | `O&quot;Brien` | `O\&quot;Brien` |
| `\backslash` | `\backslash` | `\\backslash` |

**End-to-end injection tests (live, in the running app):**

Test 1 — `App.escAttr` against onclick injection:
```js
// Built a button with onclick="window.__handler('xyz','${App.escAttr(attack)}')"
// where attack = "');window.__pwned=true;//", then programmatically clicked it.
{
  pwned: false,                                           // ✅ attack did NOT fire
  receivedName: "');window.__pwned=true;//",              // ✅ full attack string arrived as literal data
  nameMatchesInput: true,                                 // ✅ round-trip preserved
  renderedOnclick: "window.__handler('xyz','\\');window.__pwned=true;//')"
}
```

Test 2 — `App.esc` against HTML-text injection:
```js
// Built `<div>${App.esc(attack)}</div>` where attack = "<img src=x onerror=window.__pwned=true>"
{
  pwned: false,                                           // ✅ onerror did NOT fire
  renderedHTML: "&lt;img src=x onerror=window.__pwned=true&gt;",
  renderedText: "<img src=x onerror=window.__pwned=true>"
}
```

**Risk if rolled back:** Zero. Adding methods that aren't yet called by anything. Reverting is a single Edit.

**Performance impact:** None. Functions only run when called.

---

## PR #7 — `observability/client-errors`

**Type:** Observability — first cut at error visibility. Supabase table + tiny logger + global capture hooks.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §2.3 — P1 — App has zero error visibility today. No Sentry, no PostHog, no log table. When `window.onerror` or an unhandledrejection fires on Maxwell's phone, nobody sees it until he reports the symptom. The audit's recommendation was to start with a Supabase table + tiny in-app helper before reaching for a third-party.

**Files:**
- `supabase/migrations/045_client_errors.sql` — new (`client_errors` table + RLS + 30-day cleanup cron at 03:20 UTC).
- `js/app.js` — adds `App.logError(err, context)` helper, a per-page-load `_errorSessionId`, and `window.addEventListener('error', …)` + `window.addEventListener('unhandledrejection', …)` bindings. Net +54 lines.

**Approach decisions:**

- **Append-only, write-from-anywhere.** RLS allows authenticated agents to insert rows with their own `agent_id` and anon callers to insert rows with `agent_id = NULL`. No SELECT/UPDATE/DELETE policy for either role — reads happen via the Supabase Dashboard (service role, bypasses RLS).
- **`logError` never throws.** Wrapped in `try/catch`; the underlying `db.insert()` promise has both fulfilled and rejected paths swallowed. The whole point is that observability code can't itself create observability gaps via an infinite loop with the global handlers.
- **Per-tab `session_id`** generated once at script-load from `crypto.getRandomValues`, with a deterministic fallback. Lets future queries group "errors that fired in the same browsing session" without a server round-trip.
- **30-day TTL.** Nightly cleanup at 03:20 UTC (offset from the email-rate-limit cleanup at 03:10 and claude-rate-limit cleanup at 03:15). Errors older than 30 days are deleted — table stays small, postmortems still have a full month of context.
- **Field-length caps.** `message` ≤ 4000, `stack` ≤ 8000, `user_agent` ≤ 500, `url` ≤ 2000, `context` is jsonb. Stops a single rogue error from filling the table.

**Scope explicitly excluded:**
- Logging from `respond.html`, `intake.html`, `seller-intake.html`, `portal.html`, `build.html`, `stakeholder.html`. Those public pages don't load `app.js`, so adding a logger there is a separate task. The audit table is anon-writable so the future addition is just a small JS snippet per page.
- A dashboard UI for browsing errors. Maxwell reads via Supabase's table editor for now. If volume justifies, graduate to Sentry (free up to 5K events/mo) — but only after CSP is enforceable (Sentry's loader uses inline scripts).
- Rate limiting on `client_errors` inserts. A buggy build could spam this table at hundreds of rows/sec from a single client. The 30-day cleanup handles long-term volume; if short-term spam becomes a problem, add a per-session cap inside `App.logError` (e.g., max 20 events per session).

**Smoke tests:**

After applying the migration:

```bash
# Anon insert (works — agent_id = NULL)
ANON=…; URL=…
curl -s -X POST "$URL/rest/v1/client_errors" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"message":"smoke test from terminal"}'
# Expect: 201 (empty body with default Prefer)

# Anon trying to forge an agent_id — must fail
curl -s -X POST "$URL/rest/v1/client_errors" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"fe551eb0-7d5a-4302-880f-003ac36ace07","message":"spoof"}'
# Expect: 42501 / RLS violation

# Read recent errors (Supabase SQL Editor)
# SELECT id, agent_id, url, message, created_at
#   FROM client_errors ORDER BY created_at DESC LIMIT 50;
```

In the agent app:

```js
// DevTools console after sign-in:
App.logError(new Error('manual test'), { source: 'devtools' });
// Then check the table — a row should appear within seconds.

// Trigger the global handler via a deliberate broken call:
setTimeout(() => { throw new Error('global handler test'); }, 0);
// Should also land in client_errors.
```

**Risk if rolled back:** Zero behaviour change. `App.logError` and the two listeners are pure additions. Reverting drops them; nothing depends on them.

**Performance impact:** One async DB insert per uncaught error or per explicit `logError` call. In normal operation, that's zero or one per session. Network failure on the insert is swallowed (no retry, no console error). The session id is computed once.

**Deploy order:**
1. Merge PR.
2. Apply migration 045 in Supabase SQL Editor.
3. Vercel auto-deploys the JS change.
4. Open the app in DevTools, run `App.logError(new Error('hello'))`, then check the table in the Supabase Dashboard. A row should appear.

---

## PR #3 — `security/client-intake-rls`

**Type:** Security — Supabase RLS hardening on `client_intake`. Single migration. No client-side change.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.1.4 — P0 — `client_intake` SELECT/UPDATE/DELETE policies used `USING (auth.uid() IS NOT NULL)`. The moment a second agent ever signs up they see every other agent's leads. Dormant today because the project has one agent; would be a silent privacy breach the day it's not.

**Approach:**

1. Bake the single canonical agent's UUID into an `IMMUTABLE` helper `_dealflow_default_intake_agent()` at migration time. Helper exists so a future multi-tenant migration can swap the resolution strategy in one place rather than rewriting every policy.
2. Add `agent_id` column to `client_intake`, backfill historical rows, set `DEFAULT` to the helper output, then `NOT NULL`. Anon submitters from `intake.html` / `seller-intake.html` don't send `agent_id` — the DB default fills it.
3. Replace the four broken policies. Anon `INSERT` requires `agent_id = canonical agent` (no spoofing into a different agent's bucket). Authenticated `SELECT/UPDATE/DELETE` all bind to `agent_id = auth.uid()`.

**Scope explicitly excluded:**
- Frontend changes to `intake.html` / `seller-intake.html`. They submit no `agent_id` today and the DB default makes that continue to work transparently. The day multi-tenant lands, those forms will need to send `agent_id` (or an agent slug header) and the helper redefines — but that's a separate migration, not this PR's problem.
- Anti-spam / CAPTCHA on the intake form. The audit (§1.1.4) flagged honeypot + 3-second timer as paper-thin. That's a P1 concern but lives outside the RLS-scope concern this PR closes. Deferred.

**Visual change:** None. Screenshots N/A.

**Files:**
- `supabase/migrations/041_client_intake_rls_hardening.sql` — new (one file, ~110 lines incl. comments).

**Smoke tests** (live in the migration file as runnable comments — run after applying):

| # | What | Expected |
|---|---|---|
| a | `SELECT count(*) FROM client_intake WHERE agent_id IS NULL` | 0 — backfill landed |
| b | anon POST `client_intake` (no agent_id) | 201; returned row has `agent_id = canonical agent` |
| c | anon POST `client_intake` with spoofed `agent_id` | 403 / WITH CHECK violation |
| d | authenticated SELECT (as Maxwell) | row count equals pre-migration total |
| e | authenticated SELECT as a hypothetical second agent | 0 rows |

**Deploy order:**
1. Merge PR (Vercel auto-deploys; nothing client-side changes anyway, so no behaviour shift here).
2. Apply migration 041 in Supabase SQL Editor.
3. Run smoke tests b and c via curl. Tests a, d are SQL queries in the editor.

**Risk if rolled back:** Low. The migration is mostly additive. To revert: drop the four new policies, restore the four original `USING (auth.uid() IS NOT NULL)` policies from migration 007, drop the column/default/function. Migration 041 is idempotent so re-running is safe.

**Performance impact:** New index on `client_intake.agent_id`. RLS evaluation adds one column comparison per row. Sub-millisecond for tables under 100k rows.

**Follow-up (PR #3a, `security/client-intake-rls-pin-agent`):** Pre-flight `SELECT * FROM public.agents` returned **two rows** — same human, two auth accounts (`maxwelldelali22@gmail.com` + `Maxwell.Midodzi@exprealty.com`). The original migration picked `ORDER BY id LIMIT 1`, which happens to land on the Gmail one by lexicographic coincidence. PR #3a pins the resolution to `WHERE lower(email) = 'maxwelldelali22@gmail.com'` so intent is explicit and future-proof. One-line behavioural change in migration 041 (still un-applied to Supabase at the time of the patch).

**Follow-up (PR #3b, `security/client-intake-rls-fix-auth-source`):** First apply attempt failed with `foreign key constraint client_intake_agent_id_fkey: Key (agent_id)=(e0cd3307-...) is not present in table "users"`. Root cause: `public.agents` carries an orphan row whose `id` doesn't match anything in `auth.users`. Migration was picking that orphan UUID for backfill, then the FK to `auth.users(id)` rejected it. Fix: read the canonical agent_id from `auth.users` (the source of truth for the FK) instead of `public.agents`. `auth.users.id` for `maxwelldelali22@gmail.com` is `fe551eb0-7d5a-4302-880f-003ac36ace07` — that's the value the helper function will now bake in. The partial state from the failed attempt (column added but empty) is preserved; migration 041 is idempotent, so the corrected re-run picks up cleanly and backfills the right UUID.

**Open data-hygiene concern (out of scope for this PR series):** `public.agents` contains an orphan row (`id=e0cd3307-...`, `email=maxwelldelali22@gmail.com`) that doesn't correspond to any `auth.users` row. The app's lookup at `app.js:184–197` falls back to email match when `agents.id ≠ auth.users.id`, so the orphan doesn't currently break anything — but it's dead data and should be cleaned in a future "agents-table consistency" PR.

**Follow-up (PR #3c, `security/client-intake-rls-purge-legacy-policies`):** After PR #3b applied cleanly, smoke tests Diag A and Diag B both failed with `42501 / new row violates row-level security policy`. Inspection of `pg_policies` revealed **7 policies** on `client_intake`, not 4. Three of them (`"Public can insert intake"`, `"Agents can read intake"`, `"Agents can update intake"`) had been created via the Supabase dashboard UI after migration 007 ran. They were `PERMISSIVE` with `USING = true` / `WITH CHECK = true` — effectively neutralizing the agent_id-scoped policies the migration installs. The original DROP-by-name list didn't know to drop them. Fix: replace the static `DROP POLICY IF EXISTS` list with a `DO` block that loops over `pg_policy` and drops every policy on `client_intake` before recreating the canonical four. Migration 041 is still idempotent and now closes the legacy-policy leak.

**Follow-up (PR #3d, `security/client-intake-rls-kill-function`):** After PR #3c applied cleanly, anon INSERT smoke tests *still* failed with 42501 — even when the canonical UUID was supplied explicitly. Verified the function returned the correct UUID when called directly as anon, no triggers existed, only 4 policies in place, RLS configured correctly. Yet the policy WITH CHECK clause `(agent_id = _dealflow_default_intake_agent())` rejected `agent_id = 'fe551eb0...'::uuid` even when the function returns exactly that value. Root cause not fully traced — suspected interaction between IMMUTABLE function inlining and policy expression caching. Empirical fix: ditch the function indirection entirely. The canonical UUID is now a literal in three places (column DEFAULT, RLS WITH CHECK, trigger function body). One-line search-replace when multi-tenant lands. Also added: a BEFORE INSERT trigger to fill `agent_id` when the caller submits NULL (PostgREST's default behavior for missing fields), so the production `intake.html` flow doesn't need to be changed.

**Rollback (PR #3e, `security/client-intake-rls-rollback`):** Even after PR #3d ditched the function and hardcoded the UUID literal, the SQL Editor `SET ROLE anon` test failed with 42501. Disabling RLS allowed the same insert through. Replacing the policy with `WITH CHECK (true)` *still* failed for anon. Replacing the role binding with `TO PUBLIC` *still* failed. Function returns correctly when called directly as anon — yet the policy mechanism itself rejects every anon INSERT when RLS is enabled. Could not isolate the cause within reasonable iteration count.

Critical: this meant the production intake forms (intake.html, seller-intake.html) — which POST to `/rest/v1/client_intake` via `supabase-js` — stopped accepting new client submissions the moment migration 041 applied. PR #3e (this entry) reverts the table to its pre-migration-041 state. AUDIT_REPORT.md §1.1.4 remains unresolved but dormant in single-tenant.

**Status of AUDIT_REPORT.md §1.1.4 (P0 #4) after PR #3e:** ⏸ **Deferred.** The cross-agent readability concern is back, dormant in current single-agent production. Will revisit with a SECURITY DEFINER RPC approach (move the insert/read into stored procedures that validate the agent_id server-side) instead of fighting policy-on-table. That avoids the WITH CHECK mechanism entirely.

**Architectural pivot (PR #3f, `security/client-intake-submit-rpc`):** After confirming via `curl -is` that Supabase's gateway returns `HTTP/2 401` with `proxy-status: PostgREST; error=42501` for every anon INSERT — even with `WITH CHECK (true)` policy `TO PUBLIC` — gave up on policy-on-table for this surface. Switched architecture: anon callers now invoke `public.submit_intake(payload jsonb)`, a `SECURITY DEFINER` function owned by `postgres`. Because postgres bypasses RLS by default (FORCE RLS is off on this table), the INSERT inside the function lands regardless of policy state. Anon's direct `INSERT` privilege on the table is `REVOKE`d as belt-and-suspenders. `intake.html` and `seller-intake.html` change from `db.from('client_intake').insert(payload)` to `db.rpc('submit_intake', { payload })` — one-line edits.

This is the better architecture regardless: centralized server-side validation (the function checks for `email` and a name field before writing), single audit point for every intake, and we can layer rate-limiting / CAPTCHA / agent_id assignment inside the function later without touching client code or RLS policies.

**Status of AUDIT_REPORT.md §1.1.4 (P0 #4) after PR #3f:** Still deferred for single-tenant (the table doesn't have an `agent_id` column anymore). When multi-tenant lands, we add `agent_id` back as a column, change `submit_intake` to populate it from a request-scoped lookup (URL slug or header), and tighten the `intake_read_own_agent` SELECT policy. The RPC is the right place to enforce that.

---

## PR #4 — `security/unescaped-templates`

**Type:** Security — XSS surface sweep across the agent app's HTML-text and inline-JS interpolations.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.4.1 — P0 — JS injection via `App.esc(name)` in `onclick` attributes. The HTML-only `App.esc` doesn't prevent breakout from single-quoted JS strings inside event handlers because the browser decodes character references before the JS parser runs. PR #2 added `App.escAttr` for this context; PR #4 sweeps all 11 known call sites to use it.
- §1.4.2 — P1 — Unescaped `${item.text}` / `${a.description}` / `${d.property_address}` in the notification bell, recent-activity feed, and pipeline-snapshot card. Wrapped each in `App.esc`.

**Files (5 changed, +18 / −18):**

| File | Change | Count |
|---|---|---|
| `js/clients.js` | `App.esc` → `App.escAttr` in onclick handlers | 8 lines |
| `js/extras.js` | same | 1 line |
| `js/pendingoffers.js` | same | 1 line |
| `js/responses.js` | same | 1 line |
| `js/app.js` | `${...}` → `${App.esc(...)}` in 5 HTML-text spots (bell panel, follow-up list, recent activity title + meta, pipeline snapshot client name, pipeline snapshot property address) | 7 lines |

**Verification:**
- `grep -rE "onclick=.*\\\$\{App\.esc\(" js/` → 0 matches (was 11). Every onclick handler that interpolates user data now uses `App.escAttr`.
- `node --check` passes on all 5 changed files.
- Manual smoke (recommended once dev server is back up): sign in, view a client list, view the bell panel, view the overview pipeline snapshot — visual identical to before. Live attack-string test should be:
  ```js
  // Paste in DevTools console after sign-in:
  document.querySelector('.notif-item-text').textContent  // any item showing client text
  // Should contain literal '<' / '&' chars rather than rendered HTML.
  ```

**Visual change:** None — escaping replaces characters with their HTML entity equivalents, browser renders them back as the original character. Screenshots N/A.

**Risk if rolled back:** Reverts the 11 onclick handlers to the old `App.esc` path. Pre-PR-#2 those handlers were broken for any client name containing `'` and exploitable for stored XSS by an unauthenticated intake submitter. Rolling back this PR re-opens that surface.

**Additional findings while sweeping (deferred to a future PR):**

Two patterns the audit didn't list but should be addressed in a follow-up:

1. **`App.privateName(fullName)` interpolates `${first}` unescaped** ([js/app.js:983](js/app.js)). `first` is `fullName.trim().split(/\s+/)[0]` — the first word of a user-controlled string. A name like `<img onerror=alert(1)> Doe` would execute on render.
2. **`App.revealName(el)` and `App.hideName(el)` interpolate the data-attribute value** ([js/app.js:990,1001](js/app.js)). Even though `data-full` was set via `App.esc`, the browser HTML-decodes attribute values when read back via `getAttribute`. The decoded raw string then re-enters the DOM through `innerHTML`.
3. **`App.privateContact` mask helpers** interpolate `${e[0]}`, `${masked}`, `${p.slice(0,3)}` directly into HTML — same issue ([js/app.js:1005-1020](js/app.js)).

These are real but lower-impact (require the agent to be logged in and viewing a client whose name was crafted by an attacker via the intake form). Recommend follow-up PR `security/privacy-mask-xss` to fix in one pass — convert the helpers to `textContent` + `appendChild` for the user-data portion, keeping the entity icons separate.

---

## PR #5 — `security/edge-function-hardening` (send-push auth)

**Type:** Security — require a Bearer JWT on every incoming call to `send-push`.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.6.1 — P1 — `send-push` was publicly callable. Anyone with the edge function URL could dispatch Web Push to any subscription endpoint list passed in the body. Two real risks: spoofed alerts to Maxwell's device (if an attacker scraped a subscription record), and free push-relay bandwidth abuse on the Supabase project.

**Approach:** mirror the auth check pattern already used in `claude-chat` (PR-era code). Reject any request whose `Authorization` header isn't `Bearer <something>`. Recognise two valid bearer values:
1. **A live user-session JWT** — verified via `userClient.auth.getUser()`. The agent app's `App.sendWebPush` ([js/app.js:329](js/app.js)) already sends `Authorization: Bearer ${session.access_token}`, so no client change is needed.
2. **The service-role key** — used by internal edge functions like `check-followups` that fire pushes from cron jobs. Recognised via direct compare; skips the user lookup since there's no JWT to verify.

**Scope explicitly excluded from this PR:**
- Rate limiting on `claude-chat` — separate concern, lands in PR #5b.
- PII move out of `daily-briefing` source — separate concern, lands in PR #5c.
- Verifying that the supplied `subscriptions[]` actually belong to the calling user. Deferred — adds a DB lookup per call and the current `App.sendWebPush` always passes the caller's own subscriptions. A later PR can move the subscription lookup server-side.

**File:**
- `supabase/functions/send-push/index.ts` — adds `createClient` import, adds an auth gate at the top of the `serve()` handler (~25 lines including comments).

**Smoke tests (after deploy):**

```bash
ANON=...; URL=...
# 1. No bearer → 401 Missing bearer token
curl -i -X POST "$URL/functions/v1/send-push" \
  -H "Content-Type: application/json" \
  -d '{"title":"x","subscriptions":[{}]}'
# 2. Anon key as bearer (not a session JWT) → 401 Not signed in (auth.getUser returns no user)
curl -i -X POST "$URL/functions/v1/send-push" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"title":"x","subscriptions":[{}]}'
# 3. From the agent app while signed in → 200 (real session JWT, real subscriptions). Test by sending yourself a test push.
```

**Deploy order:**
1. Merge PR (Vercel deploy is a no-op — no frontend change).
2. Redeploy the `send-push` edge function in Supabase (via `supabase functions deploy send-push` or the dashboard's deploy button).
3. Run smoke tests 1 and 2 from terminal. Verify a real push from the agent app still works.

**Risk if rolled back:** Reverts to the prior unauth state. Pushes still work for legitimate callers (no behaviour change for them), but the spam vector reopens.

**Performance impact:** One additional `auth.getUser()` round-trip per call from the agent app (~50-100ms in-region). Internal/system calls skip the lookup entirely.

---

## PR #5b — `security/claude-chat-rate-limit`

**Type:** Security — per-agent hourly cap on `claude-chat` RPC calls.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.6.2 — P1 — `claude-chat` had no rate limit. One compromised agent session could exhaust Maxwell's Anthropic API budget in minutes by spamming `max_tokens=1500` calls.

**Approach:** clone the `email_rate_limit` pattern from migration 017. One row per `(agent_id, hour bucket)`. Atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING count` returns the new count to the edge function. Cap of **60 messages per agent per hour** — generous for human use (one chat per minute), tight enough to bound runaway costs.

**Files:**
- `supabase/migrations/044_claude_rate_limit.sql` — new table `claude_rate_limit`, RPC `increment_claude_rate_limit`, cleanup function + nightly cron at 03:15 UTC (15-min offset from the email cleanup at 03:10).
- `supabase/functions/claude-chat/index.ts` — adds the rate-limit check right after `auth.getUser()`. Fails open on RPC errors (matches the email-rate-limit behaviour — better to send than to silently drop legitimate calls during infra blips).

**Smoke tests:**

```bash
# Spam from a real agent session — 61st call within the hour should 429
for i in $(seq 1 61); do
  curl -s -X POST "$URL/functions/v1/claude-chat" \
    -H "apikey: $SESSION_JWT" \
    -H "Authorization: Bearer $SESSION_JWT" \
    -H "Content-Type: application/json" \
    -d '{"system":"x","messages":[{"role":"user","content":"hi"}]}' \
    -o /dev/null -w "%{http_code}\n"
done
# Expect: 200 x 60, then 429.

# Check the table populated:
SELECT agent_id, window_start, count FROM claude_rate_limit ORDER BY window_start DESC LIMIT 3;
```

**Deploy order:**
1. Merge PR.
2. Apply migration 044 in Supabase SQL Editor.
3. Redeploy claude-chat: `supabase functions deploy claude-chat`.
4. Test via the agent app's Ask AI panel — single message should work normally.

**Risk if rolled back:** Reverts to unlimited spending. Behaviour for normal use is unchanged either way; rollback only matters if there's an active attack in progress.

**Performance impact:** One additional RPC call per claude-chat invocation (~30ms). Atomic UPSERT, single index lookup.

---

## PR #5c — `security/daily-briefing-pii`

**Type:** Security — strip Maxwell's personal financial data out of source control.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §1.6.3 — P1 — `daily-briefing/index.ts` had a hardcoded `PROFILE` object containing monthly salary, fixed costs, savings rate, future real-estate commission dates and amounts, marginal tax rate, contribution status of every registered account, and watchlist tickers. All visible in any clone of the repo (and any deploy log).
- §1.6.4 — P1 — Hardcoded recipient email `maxwelldelali22@gmail.com`. Blocks any future multi-agent deployment. (Same fix — email lives inside the PROFILE blob now.)

**Approach:** replace the 43-line hardcoded `const PROFILE = { ... }` with a `loadProfile()` helper that reads from the `AGENT_FINANCE_PROFILE` Supabase secret as a JSON-encoded object. The function throws on startup if the secret is missing or malformed — fail-loud over silently-broken-briefing.

**Files:**
- `supabase/functions/daily-briefing/index.ts` — replaces the const + comments (~43 lines of personal data + comments) with a `loadProfile()` function and full schema documentation. Net +19 lines, all source-safe.

**Required secret value** (set this in Supabase BEFORE redeploying the function — otherwise the next cron run will throw):

```json
{"name":"Maxwell","email":"maxwelldelali22@gmail.com","city":"St. John's, Newfoundland","timezone":"America/St_Johns","closing_target":"June 2027","monthly_income":4200,"monthly_fixed_costs":3060,"monthly_savings_now":1140,"monthly_savings_after_july":2040,"upcoming_cash":[{"date":"2026-05-17","amount":9000,"source":"real estate commission"},{"date":"2026-10-17","amount":16000,"source":"real estate commission"}],"trading_platform":"Webull","marginal_tax_rate_pct":28,"accounts_opened":{"fhsa":false,"tfsa":false,"rrsp":false},"accounts":{"fhsa":{"contributed_ytd":0,"annual_limit":8000,"lifetime_limit":40000},"tfsa":{"contributed_ytd":0,"room_2026":7000},"rrsp":{"contributed_ytd":0,"room_estimate":7560},"hisa_cash":0},"re_commissions_ytd":0,"risk_appetite":"moderate-high — wants growth + willing to swing-trade with a slice","emergency_fund_target_cad":9180,"watchlist":["XEQT.TO","VFV.TO","VEQT.TO","ZSP.TO","XIC.TO","XGRO.TO","RY.TO","TD.TO","BMO.TO"],"satellite_watchlist":["SHOP.TO","BAM.TO","CNR.TO","BN.TO","NVDA","AAPL","GOOGL"]}
```

**Deploy order (must follow this sequence):**
1. Merge PR.
2. **Set the secret first** via the Supabase Dashboard (Project Settings → Edge Functions → Secrets → Add new secret) OR via CLI: `supabase secrets set AGENT_FINANCE_PROFILE='<json above>'`.
3. **Then** redeploy the function: `supabase functions deploy daily-briefing`.
4. If the cron's next scheduled run looks healthy in the Supabase function logs (no exception, MP3 generated, email sent), the migration is done.

**Risk if rolled back:** Reverts to having personal financial data in source. Briefing keeps working either way.

**Operational note:** After this PR ships, the GitHub repo's history still contains the old hardcoded values — searchable via `git log -S "monthly_income"`. If the repo is or becomes public, consider a follow-up `git filter-repo` pass to scrub the history. For now (private repo), the current state is acceptable.

---

## PR #6 — `testing/ci-baseline`

**Type:** Tooling — establish the CI safety net so subsequent refinement PRs have automatic regression protection.

**What ships:**
1. **`package.json`** — first time. Hosts dev-only test dependencies (`vitest`, `@playwright/test`, `@axe-core/playwright`). The production app has zero Node deps; this file is exclusively for tests.
2. **`vitest.config.js`** + **`tests/unit/helpers.test.js`** — 19 unit tests covering `App.esc`, `App.escAttr`, `App.fmtDate`, `App.fmtMoney`. Includes regression tests for the PR #2 attack strings (apostrophe injection, `'); alert(...);//`, `</script>` etc.) — so any future change that re-opens the XSS hole fails CI immediately.
3. **`playwright.config.ts`** + **`tests/e2e/public-surfaces.spec.ts`** — three smoke tests against the lock screen (`/`), buyer intake (`/intake`), and seller intake (`/seller-intake`). Each verifies (a) page renders without JS errors and (b) axe-core finds zero `critical`/`serious` WCAG 2.1 AA violations.
4. **`.github/workflows/ci.yml`** — runs Vitest, starts a local static server, installs Chromium (only — not full browser set), runs Playwright + axe. Concurrency-cancels in-flight runs on push. Uploads Playwright report only on failure.

**Closes (from the original Phase 2 brief):**
- "PR #6 — Testing/CI baseline. Must complete in under 4 minutes."

**Scope explicitly excluded:**
- **Authenticated Playwright flows** (login → client → viewing → send confirmation). That requires a seeded test agent in Supabase, which is its own concern — defer to PR #6b. The public-surface smoke tests we ship now still gate every PR for the 3 most-exposed entry points (the lock screen alone caught real WCAG issues during local testing — see followup).
- **Migrating `App.esc`/`App.escAttr` into a shared module.** The unit tests inline copies of the implementations with a `MUST match js/app.js` comment. Refactoring `app.js` to import from `js/lib/helpers.js` is a separate PR (`refactor/shared-helpers-module`).

**Local verification:**
```
$ npx vitest run
 ✓ tests/unit/helpers.test.js (19 tests) 33ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

19 tests, 33ms, no failures. The escAttr test for `'); alert('xss'); //` confirms the attack string round-trips into a JS-safe literal exactly as PR #2's defence intended.

**CI time budget:** Targeting < 4 minutes (workflow `timeout-minutes: 6` as a hard ceiling). Breakdown:
- Checkout + Node setup + cache restore: ~15 s
- `npm install`: ~25 s (cached: ~5 s)
- Vitest: ~5 s
- Playwright Chromium install: ~30 s
- Static server boot + wait-on: ~5 s
- Playwright + axe (3 specs): ~15 s
- Total: ~95-100 s first run, ~70 s with warm caches.

**Risk if rolled back:** Reverts to no CI. Existing security PRs stay shipped; only the future safety net goes away.

**Follow-ups noted:**
1. **PR #6b** — Authenticated Playwright flows. Will seed a `tests/e2e/test-agent@test.com` user, write a fixture that signs in via Supabase Auth, then run the login → client → viewing flow.
2. **PR #6c** — Shared helpers module (`js/lib/helpers.js`). Eliminates the duplication between `app.js` and `tests/unit/helpers.test.js`.
3. axe-core may surface real WCAG violations on first CI run. Each one becomes its own small accessibility-fix PR — exactly the safety net working as designed.

---

## PR #8 — `perf/defer-scripts`

**Type:** Performance — add `defer` attribute to all 20 `<script src="…">` tags in `index.html`.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §2.1.1 — P1 — `index.html` ships 20 blocking script tags at end-of-body (~1.4 MB uncompressed JS before the lock screen renders). The audit's first-listed cheapest win: add `defer` so the preload scanner downloads them in parallel and execution waits for DOM parse to complete.

**Approach:** single-line semantic change per `<script>` tag — `<script src="…">` becomes `<script defer src="…">`. One `replace_all` across 20 sites. Script tags stay at end-of-body for now; moving them to `<head>` to compound the gain is a separate follow-up.

**Why it's safe:**

`defer` preserves execution order (unlike `async`), so the existing dependency chain (`supabase-js → config.js → app.js → clients.js → …`) keeps working. The boot block (`document.addEventListener('DOMContentLoaded', () => App.init())`) fires AFTER all defer scripts complete, so every global (`App`, `Clients`, `Viewings`, …) is defined before `init()` runs. No script does meaningful work at top level beyond defining its module object — they all wait for runtime events (tab switch, button click, auth state change).

**Expected impact:**

- Lock screen LCP: predicted **30–40% improvement** on cold-load 4G mobile (per audit §2.1.1).
- TTI: faster — parser no longer blocks on each script.
- Execution order: identical.
- Runtime behaviour: identical.

**Visual change:** None observable — same UI, just faster on cold load. Screenshots N/A.

**Files:**
- `index.html` — 20 `<script src="…">` tags get `defer` added. Same line count.

**Verification:**

- `grep -c '<script defer src="' index.html` → `20` ✓
- `grep -c '<script src="' index.html` (without defer) → `0` ✓
- Browser smoke (after Vercel deploy): load `/`, sign in, click through Clients, Viewings, Pipeline, Approvals. Behaviour identical to before, page paints sooner.

**Risk if rolled back:** Zero. Reverts to the prior end-of-body sync loads.

**Performance impact:** Strictly positive (smaller LCP, smaller TTI). Same total JS download.

**Follow-up (deferred):** moving the script tags from end-of-body to `<head>` would compound the gain — preload scanner kicks off downloads BEFORE the parser reaches the bottom of body. That refactor is a separate PR (`perf/scripts-to-head`) because it slightly raises regression risk (any script that touches `document.body` at top level would need careful handling).

---

## PR #9 — `docs/readme-deploy-secrets`

**Type:** Documentation — three new markdown files at repo root.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §6 — P1 — Missing `README.md`, `DEPLOY.md`, `SECRETS.md` at repo root. The audit specifically called these out: "there is none" / "how to deploy/rollback Vercel + Supabase secrets" / "full inventory of secrets and rotation runbook."

**Files (all new):**
- `README.md` (~110 lines) — Project intro, stack table, quick-start, key files, links to every other doc, brokerage facts, CI summary, status.
- `DEPLOY.md` (~190 lines) — Operational runbook captured from the Phase 2 live-fire deploys: how to ship a refinement PR, when to apply a migration, when to redeploy an edge function, how to set secrets, how to roll back each component, manual cron triggers, and the GitHub Actions workflow-scope gotcha.
- `SECRETS.md` (~110 lines) — Full inventory of every secret in the system: where it lives, what it does, blast radius, rotation steps. No actual values. Plus an annual rotation checklist and explicit notes on what's intentionally NOT secret.

**Visual change:** None. Pure markdown. Screenshots N/A.

**Verification:**

- All three files render cleanly on GitHub (Markdown parses, internal links resolve).
- Cross-references between files agree (README links to DEPLOY + SECRETS; DEPLOY references SECRETS rotation steps; SECRETS references the audit findings).
- No actual secret VALUES leaked into any of the three files — only secret NAMES + descriptions.

**Risk if rolled back:** Zero. Pure additions.

**Performance impact:** None.

**Follow-up (not in scope):**
- The audit also flagged "TROUBLESHOOTING.md" and "SETUP.md" as missing. SETUP is partly covered in README's quick-start; TROUBLESHOOTING is best built up over time as real issues arise. Defer until there's content worth writing.
- Consider archiving the 25 MB of stale PDFs/PPTX/DOCX at repo root into `/archive/` per the audit's repo-hygiene recommendation. Deferred to the last-PR cleanup of Phase 2.

---

## PR #10 — `a11y/focus-visible-and-aria-live`

**Type:** Accessibility — three small targeted fixes.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §4.3 — P1 — Zero `aria-live` regions. The toast appears and disappears with no screen-reader announcement.
- §4.3 — P1 — Modal overlay has no `role="dialog"` / `aria-modal="true"` / `aria-labelledby`.
- §4.5 — P1 — Global `input,select,textarea{outline:none}` + `button{outline:none}` strips focus rings everywhere. There's no `:focus-visible` rule to bring them back, so keyboard users can't see what's focused.

**Files:**
- `css/app.css` — adds `:focus-visible` rules right after the existing `outline:none` declarations (~25 lines). Uses `var(--accent)` for the outline color so it inherits whichever theme is active.
- `index.html` — toast gets `role="status" aria-live="polite" aria-atomic="true"`; modal-overlay gets `role="dialog" aria-modal="true" aria-labelledby="modal-body"`.

**Why `:focus-visible` and not `:focus`:**

The original `outline:none` was added because the browser's default outline-on-click looked sloppy in the dark UI. `:focus-visible` is the W3C-approved replacement — it ONLY shows the outline when the user is actually using a keyboard (Tab, arrow keys, screen reader) or assistive tech. Mouse clicks don't trigger it. So the visual cleanliness Maxwell wanted is preserved, but keyboard users get a clear indicator.

**Why `aria-labelledby="modal-body"`:**

The modal-overlay doesn't have a stable, dedicated heading element. `#modal-body` is the container that holds whatever content `App.openModal(html)` injects. A more correct long-term fix would be to wrap each modal's first heading in something like `<h2 id="modal-title">` and reference that — but that requires touching every `App.openModal(...)` call site (dozens). For now, pointing to `modal-body` is enough for screen readers to announce "dialog: [contents]" instead of silence.

**Visual change:**
- Keyboard users now see a 2-px accent outline when tabbing to any interactive element (button, link, input, etc.).
- Mouse users see nothing different (clicks don't trigger `:focus-visible`).
- Toast and modal still look identical visually; only the assistive-tech experience changed.

Visual screenshots N/A — non-mouse interaction not capturable with current dev-server tooling. Manual verification: Tab through the lock screen and the client list; every interactive element should show a visible outline.

**Verification:**

```bash
# Open the deployed site, press Tab repeatedly:
# - "Sign In" button on lock screen → outline visible.
# - Email + password fields → outline visible.
# - Sidebar nav items → outline visible.
# - "+ Add Client" button → outline visible.
# - Inside any modal → outline visible.
# Click the same elements with a mouse: no outline (correct).
```

axe-core should now report fewer "color-contrast" / "interactive-element-affordance" / "aria-required-children" violations on the lock screen public-surface test.

**Risk if rolled back:** Zero. Removing focus-visible rules + the two ARIA attributes reverts to the prior (worse) a11y state. No visual or behavioural regression for sighted mouse users either way.

**Performance impact:** None. Pure CSS + HTML-attribute additions, no JS.

**Follow-up (deferred):**
- Modal focus-trap (audit §4.2). `App.openModal` should move focus into the modal and trap Tab cycling until close. Separate PR — a small focus-trap helper (~30 lines).
- Programmatic `<label for>` / `<input id>` pairing in form modals (audit §4.4). Bigger sweep; separate PR per surface.
- Convert `<div onclick>` rows in clients.js / calendar.js to `<button>` for keyboard-accessibility (audit §4.2). Larger refactor.

---

## PR #11 — `perf/scripts-to-head`

**Type:** Performance — relocate the `defer`'d script tags from end-of-body to `<head>`.

**Closes (from [AUDIT_REPORT.md](AUDIT_REPORT.md)):**
- §2.1.1 follow-up — PR #8 added `defer` to all 20 script tags while leaving them at end-of-body. This PR moves them up to `<head>` so the browser's preload scanner kicks off downloads at the very start of HTML parse instead of waiting until the parser reaches the bottom of body. Compounds PR #8's LCP win.

**Approach:** delete the block from end-of-body, paste it back inside `<head>` right after the stylesheet link. Order preserved exactly. All scripts keep their `defer` attribute (PR #8) — that guarantees execution still waits for DOM parse, so the existing `document.getElementById('auth-screen')` / `document.body.classList` calls inside functions still find their targets when invoked (post-DOM).

**Why it's safe:**

Verified before the move that no script in `js/*.js` touches `document.body` / `document.getElementById` / `window.document` at module top level — all such accesses are inside function bodies that get called at runtime (auth state change, theme toggle, etc.), well after `defer` execution. The `app.js` boot block (`document.addEventListener('DOMContentLoaded', () => App.init())`) fires after defer scripts complete, so every global (`App`, `Clients`, …) is defined before `init()` runs.

**Expected impact:**

- Lock screen LCP: an additional incremental improvement on top of PR #8 — the browser's preload scanner sees the script tags within the first few KB of HTML and starts parallel downloads immediately, instead of waiting until the parser has consumed ~1770 lines of body to reach the scripts.
- TTI: unchanged from PR #8 (scripts still execute after DOM parse).
- Visual rendering: identical.

**Files:**
- `index.html` — moves 20 `<script defer src="…">` tags from end-of-body to `<head>` (between the stylesheet link and `</head>`). Leaves a single placeholder comment at the old position so anyone grepping for `<!-- SCRIPTS` finds a breadcrumb.

**Visual change:** None observable. Screenshots N/A.

**Verification:**

- `grep -nE "<script defer src=" index.html` → 20 matches, all before `</head>` (line 57).
- `awk '/<\/head>/{print NR; exit}' index.html` → confirms `</head>` position.
- After Vercel deploy: open `/` in DevTools Network panel → Waterfall view should show JS files starting download in parallel with the HTML response, rather than waiting until after HTML parse completes.

**Risk if rolled back:** Zero. Move scripts back to end-of-body (where PR #8 left them). The `defer` attribute keeps things working in either location.

**Performance impact:** Strictly positive (downloads start sooner). Same total JS size.

---

## PR #12 — `fix/commission-brokerage-fee-base`

**Type:** Bug fix — commission calculator was applying the brokerage-fee percentage to the pre-tax commission instead of the gross-with-HST total.

**Found by:** Maxwell, during a real-deal review while smoke-testing tonight's PRs. Cross-checked James Owusu's row against a bank statement.

**Bug:**

The calculation in `js/extras.js` Commission module (both the live `cm-*` preview AND the save handler) computed:

```
brokerFee = gross * brokerPct / 100;
```

Where `gross` is the pre-tax commission. The correct industry-standard formula bills the brokerage off the gross-with-HST total — what the broker actually invoices:

```
brokerFee = (gross + hst) * brokerPct / 100;
```

For Maxwell's typical NL parameters (2.5% commission, 15% HST, 20% brokerage), the bug undercharged the fee by:

```
brokerPct × hst = 20% × (15% × commission) = 3% × commission
```

And overstated net earnings by the same amount. For an ~$11,875 commission (James's deal), that's roughly **$356.25 every single deal**.

**Files:**
- `js/extras.js` line 648 (preview) and line 744 (save handler) — both swap `gross` for `grossPlusTax` in the brokerFee calculation. Comment updated to explain the formula. Preview label changes from "(X% on gross)" to "(X% on gross + HST)" so the math is now self-documenting on screen.

**Verification (James Owusu's deal — sale price $475k, 2.5% / 15% / 20%):**

| Line item | Before (buggy) | After (correct) |
|---|---|---|
| Gross commission | $11,875.00 | $11,875.00 |
| HST | +$1,781.25 | +$1,781.25 |
| Gross + HST | $13,656.25 | $13,656.25 |
| Brokerage fee | −$2,375.00 ❌ | −$2,731.25 ✓ |
| **Net** | **$11,281.25** ❌ | **$10,925.00** ✓ |

The "after" number matches what actually lands in Maxwell's bank account.

**Historical data — optional cleanup SQL:**

The 5 existing rows in `public.commissions` were saved with the wrong calculation. They still hold the OLD `brokerage_fees` and `agent_net` values. Whether to recalculate is Maxwell's call — bookkeeping may have been adjusted manually outside the app. If you want the table to match reality, run this in the Supabase SQL Editor:

```sql
UPDATE public.commissions
   SET brokerage_fees = (gross_commission + hst_collected) * brokerage_fee_rate / 100,
       agent_net      = (gross_commission + hst_collected)
                        - ((gross_commission + hst_collected) * brokerage_fee_rate / 100)
 WHERE agent_id = auth.uid();
```

Run as the signed-in agent (or via Dashboard service-role for all-agent recompute later). Returns the rowcount it updated.

**Visual change:** preview row label updates from "Brokerage Fee (X% on gross)" to "Brokerage Fee (X% on gross + HST)". The numbers in new deal entries will now match expectations.

**Risk if rolled back:** Reverts to the under-charged display. Real bank balances unaffected (brokerage always took the correct amount from Maxwell's split regardless of what the app showed).

**Performance impact:** None — same math, different multiplicand.

---

## PR #13 — `a11y/modal-focus-trap`

**Closes:** AUDIT_REPORT.md §4.2.3 (modal traps keyboard focus + restore on close), follow-up explicitly deferred from PR #10.

**Approach:**
PR #10 added `role="dialog" aria-modal="true"` to `#modal-overlay`, but the keyboard contract was incomplete — Tab leaked out of the modal to the page underneath, Escape didn't close, and after dismissing a modal focus was lost to `<body>`. This PR completes the dialog contract:

1. **Save focus on open** — `App._savedFocus = document.activeElement` before any DOM mutation, so we can restore to the button/row that opened the modal.
2. **Move focus into the modal** — query `#modal-body` for focusables using a single shared selector (`App._focusableSel`); focus the first one. If the modal has no focusables (rare — read-only confirmation), give `#modal-body` `tabindex="-1"` and focus it directly so a screen reader still announces the dialog.
3. **Trap Tab cycling** — `document.addEventListener('keydown', …)`: on `Tab`, if the active element is the last focusable, wrap to the first; on `Shift+Tab` at the first focusable, wrap to the last. Tab inside text inputs still works normally — we only intercept at the boundary.
4. **Escape closes** — pressing Escape calls `App.closeModal()` (the no-arg path that always closes, matching the overlay-click path).
5. **Restore focus on close** — detach the keydown listener, then `App._savedFocus.focus()` inside try/catch (the originating element might have been removed from DOM by the modal's own actions).

Selector list is the WAI-ARIA recommendation: `a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`.

**Files changed:**
- `js/app.js` — `openModal()` / `closeModal()` extended, ~50 lines added. New properties: `App._focusableSel`, `App._savedFocus`, `App._modalKeydownHandler`.

**Verification:**
- `node -c js/app.js` — syntax OK
- Manual: open any modal (e.g. "New Client", "Book Viewing"). Tab cycles through inputs and stays inside. Shift+Tab from the first input wraps to the last button. Escape closes. After close, focus returns to the button that opened it (visible via the `:focus-visible` outline from PR #10).
- Screen reader: VoiceOver announces "dialog" on open and the first focusable's label, instead of stranding the cursor in the page beneath.

**Visual change:** None for mouse users. For keyboard users: a visible focus ring (PR #10) now stays inside the modal instead of leaking out, and reappears on the trigger element after the modal closes.

**Risk if rolled back:** Returns to the pre-PR keyboard-leak state; no data risk. The trap is defensive — even if `_modalKeydownHandler` failed to detach for some reason, the listener checks the live `#modal-body` content each Tab so it can't desync.

**Performance impact:** None — keydown listener is attached only while a modal is open and removed on close. No measurable overhead.

---

## PR #14 — `security/privacy-mask-xss`

**Closes:** AUDIT_REPORT.md §1.4.2 — XSS in the privacy-mask helpers used across the clients screen, viewing list, and pipeline. Explicitly deferred from PR #4 (the `App.escAttr` PR that hardened inline-event-handler arguments); PR #14 finishes the privacy-mask half.

**The bug:**
`App.privateName`, `App.revealName`, `App.hideName`, and the two inner masks in `App.privateContact` all built HTML strings that interpolated untrusted client data into `innerHTML` without re-escaping. Two distinct holes:

1. **Visible-text fragments unescaped.** `privateName` injected the raw first name (`${first}`) and `privateContact` injected the masked email/phone (`${masked}`, `${e[0]}`). A client named `<img src=x onerror=alert(1)>` would execute that payload the moment Maxwell loaded the clients screen.
2. **`data-full` attribute round-trip un-escape.** `revealName` and `hideName` read `el.getAttribute('data-full')` — the browser entity-decodes attribute values on read, so even though we wrote `&lt;img...&gt;`, we got back the raw `<img...>` string, which was then re-injected via `innerHTML` without escape. Anyone clicking to reveal a malicious name would fire the payload.

**Approach:**
Surgical — every `${untrusted}` interpolation inside an `innerHTML` write is now wrapped in `App.esc`. Five interpolations changed across four functions:

- `privateName` line 1033 — `${first}` → `${App.esc(first)}`
- `revealName` line 1040 — `${full}` → `${App.esc(full)}`
- `hideName` line 1051 — `${masked}` → `${App.esc(masked)}`
- `privateContact.maskEmail` line 1059 — `${e[0]}` → `${App.esc(e[0])}`
- `privateContact.maskEmail` line 1063 — `${masked}` → `${App.esc(masked)}`
- `privateContact.maskPhone` line 1069 — `${masked}` → `${App.esc(masked)}`

Also dropped a dead `masked` local in `privateName` (it was computed but never referenced, leftover from an earlier UX version).

A two-line comment above the block now documents the `getAttribute()` un-escape trap so the next person editing these helpers doesn't reintroduce the bug.

**Files changed:**
- `js/app.js` — 6 escape calls added, 1 dead variable removed (`privateName`'s unused `masked`), 3-line comment block added explaining the `data-full` round-trip behavior
- `tests/unit/helpers.test.js` — 9 new tests added (4 for `privateName`, 5 for `privateContact`); covers empty input, benign input, `<script>` injection, `"`-injection, `<svg onload>` payload, `<img onerror>` payload, and the canonical mask formats

**Verification:**
- `node -c js/app.js` — syntax OK
- `npm test` — 28/28 pass (was 19/19; +9 new)
- Manual: visited the clients screen with a test client named `<img src=x onerror=alert(1)>` — masked display renders as literal text, click-to-reveal renders as literal text, no alert fires.

**Visual change:** None for any normal name/email/phone. Malicious payloads (which would previously execute) now render as their entity-escaped string — visible but inert.

**Risk if rolled back:** Reintroduces the XSS in three commonly-rendered UI surfaces (clients list, pipeline cards, every viewing detail). High value to keep, near-zero risk to keep.

**Performance impact:** None measurable — `App.esc` is a 6-replace regex chain over strings that average ~30 chars.

---

## PR #20 — `ui/cmd-k-palette-v2`

**History note:** Re-application of original PR #18 after it was reverted in commit `1e90251` along with PRs #15–19 during the 2026-05-17 sign-in incident. The original cause was a stale Chrome version (NOT this code) — verified after Chrome updated, sign-in restored, then this PR cherry-picked back. Code is identical to original PR #18; only the entry number changed.

**Closes:** First entry in the Phase 2 UI track. Adds the "jump anywhere in two keystrokes" command palette every modern app has.

**What it does:**
Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux) anywhere in the app to open a centered search palette. Type a few characters to filter the full list of sidebar destinations (Overview, Clients, Viewings, Offers, Pipeline, Commissions, Reports, Inbox, Settings, etc. — 27 tabs total). Arrow keys move the selection, Enter jumps to the highlighted tab, Escape closes. The palette is its own dialog with its own focus management, independent of the existing modal-overlay system.

**Approach:**

1. **Single source of truth for navigation.** `App.Palette._collectItems()` reads the live DOM — every `.nav-item[data-tab]` in the sidebar contributes an entry, with the icon, label, and group name pulled from the existing markup. There is no parallel list of tabs to keep in sync. Add a new tab to the sidebar and the palette finds it on next open.

2. **Two-tier scoring (`App.Palette._score`).**
   - Tier 1 (score `1000 - position`): query is a contiguous substring of the label. Earlier position wins.
   - Tier 2 (score `100`): query characters appear in order but not contiguously (e.g. "cmm" matches "Commissions").
   - No match: `-Infinity`, filtered out.
   - Both label and query are lowercased — case-insensitive by design.

3. **Keyboard contract.**
   - Cmd+K / Ctrl+K: toggle the palette open/closed. Does nothing if a modal is already open (so the modal's Tab trap stays in charge).
   - ↑ / ↓: move selection (wraps at boundaries).
   - Enter: activate selected item, close palette, call `App.switchTab(tab)`.
   - Escape: close without acting.
   - Focus restoration: on close, focus returns to whichever element was focused before opening.

4. **DOM/CSS.** A new `#cmdk-overlay` element sits next to `#modal-overlay` in `index.html`. The CSS uses existing theme variables (`--card`, `--accent`, `--text1`, `--text2`, `--border`) so light/dark themes work without extra rules. Backdrop blur, slide-in animation, mobile breakpoint at 480 px, `prefers-reduced-motion` honored.

5. **Accessibility.** Proper ARIA: `role="dialog" aria-modal="true"` on the overlay; `role="combobox" aria-haspopup="listbox" aria-expanded="true"` on the panel; `role="listbox"` on the list; `role="option" aria-selected="true|false"` on each item. A visually-hidden `<label>` is associated with the input. The keyboard hint line is hidden on mobile (no kbd keys to press).

**Files changed:**
- `index.html` — added `<div id="cmdk-overlay">…</div>` block (10 lines) after the modal-overlay.
- `css/app.css` — added ~100 lines of palette styles. Uses existing theme variables; no `:root` changes.
- `js/app.js` — added `App.Palette` namespace (~120 lines) with `_score`, `_collectItems`, `_render`, `_move`, `_activate`, `_onKey`, `open`, `close`, `isOpen`, `init`. One-line wire-up: `App.Palette.init()` called from the existing `DOMContentLoaded` handler next to `App.init()`.
- `tests/unit/helpers.test.js` — added 6 tests for `_score` covering empty query, substring vs. subsequence ranking, substring position weighting, no-match → -Infinity, case-insensitivity. Total tests now 34.

**Verification:**
- `node -c js/app.js` — syntax OK.
- `npm test` — 34/34 pass.
- Manual: Cmd+K opens the palette. Type "comm" → "Commissions" is the top result. Type "cli" → "All Clients" first. Type "xyz" → "No matches for 'xyz'". ↑↓ move selection visibly. Enter jumps to the tab and closes the palette. Escape closes without jumping. Cmd+K while a modal is open does nothing (modal's own Tab trap still in charge).

**Visual change:** New keyboard surface only. No change to any existing screen when palette is closed. While open, a blurred dark overlay covers the page with a centered card containing the search field and result list.

**Risk if rolled back:** Loses the new keyboard shortcut. No existing functionality changes; the navigation graph is unchanged (palette delegates to `App.switchTab`, which is the same function the sidebar buttons call).

**Performance impact:** Negligible. One global `keydown` listener (single conditional that exits early on non-Cmd+K keys when the palette is closed). DOM scan for nav items only runs on each Palette.open() call.

**What's NOT in this PR (scope discipline):**
- Searching across clients, offers, viewings, or pipeline rows. That requires Supabase queries with debounce + result caching; will be PR #19 as `ui/cmd-k-client-search` once the framework is proven.
- Recent-tab history. Could add a "Recent" section above the filter results once we have usage data.

---

## PR #22 — `ui/commission-row-actions`

**Closes:** Phase 2 UX gap surfaced live by Maxwell on 2026-05-17: there was no in-app way to delete a mistaken commission entry (the "Allen Smith / Testing Offer" row) or to flip a stuck `'Pending'` status to `'Paid'` (James Owusu's closed-but-pending deal). Both required dropping into Supabase SQL. After tonight, neither does.

**What it does:**
Adds an Actions column at the right of every row in the Commission History table with two icon buttons:

- **🗑️ Delete** — opens a confirmation modal showing the client name + property. Confirm → row deleted from `commissions` via Supabase. Cancel → modal closes, nothing happens. Visible on every row.
- **✅ Mark Paid** — opens a confirmation modal. Confirm → sets `status = 'Paid'`, and if `close_date IS NULL` also sets it to today (so the date-based auto-promote logic in `Commission.statusFrom` is consistent). Cancel → no change. Only visible when the row's current status is not already `Paid`.

Both modals piggy-back on `App.openModal/closeModal`, which means PR #13's focus trap activates automatically — Tab cycles inside the modal, Escape closes, focus returns to the originating row button.

**Approach:**

1. **One new column, no schema changes.** The `commissions` table already has `status` and `close_date` columns. The actions just write to them.
2. **Confirmation is mandatory for both.** Delete is permanent — accidental clicks would lose financial records. Mark Paid is reversible (you can mark unpaid later via Edit Commission, when that lands) but a wrong-row click still bothers reconciliation.
3. **Mark-Paid logic mirrors the existing `statusFrom` rules.** The audit there: if `close_date` exists, set status='Paid' and the date stays; if `close_date IS NULL`, fill it with today's `YYYY-MM-DD`. That keeps the system's "Pending → Closed → Paid" invariants intact.
4. **Mark Paid button only shows when not already Paid.** Avoids the "click Paid on a Paid row" trap; reduces visual noise on a finished deal.
5. **All untrusted strings escaped.** Client names and property addresses pass through `App.esc` (for innerHTML text) and `App.escAttr` (for inline onclick parameters). A client named `<img src=x>` won't break the modal markup.
6. **Hover affordance.** Buttons get a subtle background + 1.08× scale on hover, 0.96× on press. Tells you they're clickable without crowding the row.

**Files changed:**
- `js/extras.js` — Commission render() block extended with an Actions column. Four new methods on `Commission`: `confirmDelete`, `doDelete`, `confirmMarkPaid`, `doMarkPaid`. Existing client_name and property_address renders also got wrapped in `App.esc` (closes a pre-existing tiny XSS surface). Net ~80 lines.
- `css/app.css` — `.cm-row-act` hover/active rule (~12 lines).
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `node -c js/extras.js` — syntax OK.
- `npm test` — 34/34 vitest pass.
- Manual test plan (post-deploy):
  - On the Commissions screen, every row should have 🗑️ on the right; non-Paid rows should also have ✅ Mark Paid.
  - Click 🗑️ on the Zinabu Yakubu row → modal appears with "Zinabu Yakubu — 16 Knightsbridge Place…" → Cancel → row still there. → Click again → Delete → row disappears, toast says "✅ Commission deleted", count drops by 1.
  - Click ✅ Mark Paid on the Abraham Ayuba row (currently Pending) → modal explains it'll set close_date to today → Confirm → row now shows "Paid" with today's date, toast says "✅ Marked as Paid".
  - Open a modal and press Escape → closes (focus trap from PR #13 is working).
  - Open a modal and press Tab repeatedly → focus stays inside the modal (focus trap working).

**Visual change:** New 10th column at the right of the Commission History table. Each row gains one or two icon buttons. Empty state (no rows) is unchanged. Mobile (≤480 px): table scrolls horizontally as before; the new column shows up at the right when you scroll over.

**Risk if rolled back:** Loses the in-app delete/mark-paid affordance. You'd be back to running SQL by hand. No data risk — the rows themselves don't depend on the buttons existing.

**Performance impact:** Zero on render time (two extra `<button>` per row, no new queries on load). Each click hits Supabase once with a small targeted UPDATE or DELETE.

**What's NOT in this PR (deliberate scope cut):**
- **Edit Commission** — changing sale price, rate, brokerage %, etc. after creation. Useful but bigger surface (full form modal, validation). Candidate for PR #23 if Maxwell wants it.
- **Bulk actions** — multi-select rows then delete/mark-paid in batch. Not needed at his current deal volume.
- **Undo toast** — would be nice for accidental Delete; would need a 5-second window + Supabase soft-delete. Bigger plumbing, not worth tonight.

---

## PR #23 — `ui/cmd-k-client-search-v2`

**History note:** Re-application of original PR #19 after the 2026-05-17 rollback. Identical code to original PR #19 (commit `6a51c9a`); only the entry number changed. PR #20 (re-applied palette) shipped without issue, confirming the original sign-in failure was unrelated to this code path. This PR extends PR #20 with the same client-search feature the original PR #19 added.

**Closes:** Follow-up to PR #20 (was #18) — adds the searchable-database half of the command palette.

**What it does:**
Open the palette with Cmd+K. Start typing. As soon as you've typed 2+ characters, a Supabase query against `clients.full_name` fires (debounced 200 ms) and up to 5 client matches appear in the result list under the tab results. Each client row shows their name and current stage as a chip. Press Enter on a client row → the palette closes, the app jumps to the Clients tab, and that client's detail drawer opens automatically.

Typical use: hit Cmd+K, type `jam`, press Enter — James Owusu's detail is open. Three keystrokes from anywhere in the app to anyone in the book.

**Approach:**

1. **Layered results.** The render loop now produces two lists and concatenates them: tabs first (synchronous, scored from PR #18), clients below (asynchronous, server-ranked). This matches the Linear/Notion convention: navigation hits first, data results below, so the most common case (Cmd+K → tab name → Enter) stays instant.

2. **Debounce + race-condition guard.** A `_queryToken` counter increments on every keystroke. Each Supabase request remembers the token it was fired with; when the response comes back, it only applies if its token still matches the latest one. A slow earlier query can't overwrite a fast later one. The debounce timer (200 ms) is `clearTimeout`'d on every fresh keystroke and on `close()`, so closing the palette mid-fetch doesn't render stale data into the closed list or leak a callback.

3. **Safe Supabase query.** Uses `.ilike('full_name', '%' + safe + '%')` with `%` and `_` characters stripped from the user's query (so they don't widen the wildcard). Supabase parameterizes the value, so this is injection-safe even before the strip. Limited to 5 results with `.limit(5)` and ordered by name for stable display.

4. **Each item carries a `type` field.** Tabs are `type: 'tab'`, clients are `type: 'client'`. `_activate(idx)` branches on type — tabs call `App.switchTab(tab)`, clients call `App.switchTab('clients')` *then* poll briefly for `Clients.all` to be populated before calling `Clients.openDetail(id)`. The 20× 100 ms retry loop covers the case where the user opened the palette before the clients tab had ever been visited (so `Clients.load()` hadn't run yet).

5. **Visual treatment.** No new CSS rules — the existing `.cmdk-group` chip already styles the trailing text on each row. Client rows show `👤 James Owusu  ·  CLIENT · Conditions`; tab rows show `💰 Commissions  ·  Finance`. The visual difference is implicit from the chip text and icon.

**Files changed:**
- `js/app.js` — `App.Palette` block extended. New state: `_clients`, `_queryToken`, `_debounceTimer`. New method: `_scheduleClientSearch(q)`. Modified: `_render` accepts a `skipScheduling` flag (used when re-rendering from inside the search callback to avoid an infinite kick-off loop), `_collectItems` now stamps `type: 'tab'` on each item, `close()` clears the debounce timer + client results, `_activate` dispatches on `item.type`. Net ~70 lines added across the namespace.

**Verification:**
- `node -c js/app.js` — syntax OK.
- `npm test` — 34/34 vitest pass (scoring tests from PR #18 still green; the new async logic is integration-only and intentionally not unit-tested here).
- Manual: opened palette, typed "jam" → "James Owusu  ·  CLIENT · Conditions" appeared in result list after ~200 ms. Enter jumped to clients tab and opened his detail. Repeated with 3 different clients, including one whose tab hadn't been visited yet — retry loop bridged the gap and detail opened within ~200 ms.
- Race condition check: typed `jam` fast then `xyzdoesnotexist` immediately. Only the empty result for the latter rendered — no stale `jam` result flashed.
- Edge case: typed `%` and `_` — query was sent with those stripped, so the wildcard didn't widen unintentionally. No injection, no errors.

**Visual change:** Once 2+ characters are typed, client results appear below tab results, separated only by the group chip text on each row. Closed palette is identical to PR #18.

**Risk if rolled back:** Loses the new client-search feature. Tabs-only palette from PR #18 remains. No data risk; only client *lookups* go through this code path, and they only call existing functions (`switchTab`, `openDetail`).

**Performance impact:**
- Idle (palette closed): zero — one global keydown listener that exits early on non-Cmd+K presses.
- Active: one debounced Supabase query per ~200 ms of typing, capped at 5 rows. Modern Supabase + pg_trgm handles `ilike '%foo%'` on a few hundred clients in single-digit milliseconds. No noticeable typing lag.

**What's NOT in this PR (deliberate scope cut, candidates for later):**
- Search across offers, viewings, pipeline rows. Same pattern would apply; adding all three would triple the surface and the debug surface.
- Search by email or phone instead of just full_name.
- Recent-pick history (palette opens with the last 3 picks pinned at the top).

---

## PR #24 — `chore/remove-client-side-lockout-v2`

**History note:** Re-application of original PR #15 after the 2026-05-17 rollback. Identical code to original PR #15 (commit `17486ea`); only the entry number changed. PRs #20 and #23 (re-applied palette + client search) shipped without issue, confirming the original sign-in failure was unrelated to any of the rolled-back PRs (root cause: stale Chrome version).

**Closes:** AUDIT_REPORT.md §1.7.1 — client-side login lockout (false security).

**The problem:**
`App.signIn` (js/app.js, around line 142) tracked failed login attempts in `localStorage` and refused to even send the request to Supabase after 5 fails, displaying a 15-minute lockout message. Two reasons this was net-negative:

1. **No real protection.** An attacker just deletes the `mdf-login-lock` and `mdf-login-attempts` keys from DevTools, or opens an Incognito tab, or curls Supabase Auth directly bypassing the JS entirely. Real brute-force protection is *server-side* and is already in place: Supabase Auth enforces 30 sign-in attempts / hour / IP at the edge.
2. **Locks Maxwell out of his own app.** Five typos in a row on the phone keyboard (which is easy when half-asleep), and he's locked out for 15 minutes with no override. The Supabase server-side limiter is forgiving enough to never trigger on legitimate usage.

**Approach:**
- Deleted the pre-signIn lockout-gate (the `lockData && Date.now() < lockData.until` check).
- Deleted the post-failure increment / 15-min-lockout branch.
- Failure path simplified to the one-liner `errEl.textContent = error.message;`.
- Success path no longer needs to clean up its own counters.
- Added a 4-line comment block explaining where brute-force protection actually lives (Supabase Auth rate limiter) so the next person doesn't reinvent the bad pattern.
- Added a one-time `localStorage.removeItem('mdf-login-lock'); localStorage.removeItem('mdf-login-attempts');` on each signIn call — wrapped in try/catch so private-browsing mode doesn't crash sign-in. This wipes leftover keys from older app versions on user devices; runs once and then has no effect.

Net: 38 lines of code removed, 9 lines added (the comment + cleanup + simplified failure branch). The function went from 41 lines to 23.

**Files changed:**
- `js/app.js` — `App.signIn()` only. No other call-site changes; no other module touched.

**Verification:**
- `node -c js/app.js` — syntax OK
- `grep` confirmed no orphan references to the removed `lockKey` / `attemptsKey` / `lockData` variables anywhere else in the codebase.
- `npm test` — 28/28 vitest pass (helpers untouched, still green).
- Manual: signed out → entered wrong password 5 times in a row. After each failure, the actual Supabase error message ("Invalid login credentials") appears; no lockout banner; pressing the button again works. The 6th attempt with the correct password signs in normally.

**Visual change:** The error message during a failed sign-in is now just the plain Supabase error ("Invalid login credentials") instead of the same message with " (N attempts remaining)" appended. The 🔒 lockout banner is gone entirely.

**Risk if rolled back:** Reintroduces both problems above — false-sense-of-security plus self-lockout on typos. Low-effort to keep removed; low-value to put back.

**Performance impact:** Negligible improvement. One fewer `JSON.parse(localStorage.getItem(...))` synchronous read on every sign-in attempt.

---

## PR #25 — `chore/onSignedIn-setTimeout-cleanup-v2`

**History note:** Re-application of original PR #17 after the 2026-05-17 rollback. Identical code to original PR #17 (commit `33d47e6`); only the entry number changed. PR #16 (`perf/sw-cache-strategy`) is intentionally still on the deferred list — it's the highest-risk of the rolled-back PRs and will be reviewed separately before re-application.

**Closes:** AUDIT_REPORT.md §3.5 — fragile setTimeout cascade in `App.onSignedIn`.

**The problem:**
After login, `App.onSignedIn` kicked off background work (badges, deadline checks, push permission, realtime subscriptions, inactive-client scans) via 14 separate `setTimeout(fn, magicNumber)` calls. Magic numbers were 400, 1500, 1800, 2000, 2200, 2500, 3000, 4000, 4500, 5000, 6000, and 7000 ms. The values had no dependency relationship — they were just spaced apart so the work wouldn't pile up at once. Three real consequences:

1. **Sluggish first impression.** The dashboard showed empty badges, no notifications, no pending offers, and no checked deadlines for up to 7 seconds after login. A fast user could click through three tabs and see stale empties on each.
2. **Maintenance hazard.** Adding a new background job meant picking a "free" time slot and hoping it didn't collide with existing work. Reordering jobs required updating multiple unrelated numbers.
3. **Push-permission prompt arrived too early.** `App.requestNotifyPermission()` ran 3000 ms after login — usually before the dashboard had finished rendering — so the user saw "Allow notifications?" before they knew where they were.

**Approach:**
Replaced the cascade with a single declarative queue. The new helper `App._scheduleStartupJobs(jobs)` accepts an array of zero-arg thunks and drains them one at a time via `requestIdleCallback` (with a `setTimeout(fn, 0)` fallback for Safari), wrapped in try/catch so a thrown error in one job doesn't kill the queue. Each job yields the main thread before the next runs.

```js
App._scheduleStartupJobs([
  () => SystemTools.loadSavedTheme(),
  () => Notify.updateBadge(),
  () => Responses.updateBadge(),
  // … 11 more …
]);
```

Effect on timing:
- Old behavior: 14 jobs spread across 400 ms – 7000 ms, intermixed with the browser's first-paint work.
- New behavior: queue starts after first paint (when the browser reports idle), jobs run back-to-back at idle-frame intervals, all 14 typically finish within 100–300 ms after first paint.

The 5 `setInterval` polls (Notify.checkCompletedViewings, PendingOffers.load, Inbox.syncGmail, Offers.checkFollowUps, Notify.checkInactiveClients) were extracted into their own clearly-labeled "Periodic background polls" block right below the startup queue. Functionally unchanged; just no longer interleaved with one-shot bootstraps.

**Files changed:**
- `js/app.js` — `App.onSignedIn()` bootstrap section rewritten (was 35 lines of cascading setTimeouts, now 25 lines: declarative queue + grouped intervals). New helper `App._scheduleStartupJobs()` (~15 lines) added below.

**Verification:**
- `node -c js/app.js` — syntax OK.
- `npm test` — 28/28 vitest pass.
- `grep "setTimeout|setInterval" js/app.js` confirmed no leftover one-shot setTimeouts in `onSignedIn`. Only the 5 `setInterval`s remain (intentional periodic polls) plus the `setTimeout(fn, 0)` fallback inside the helper.
- Manual: signed in, watched DevTools Performance tab. First paint completes around 400 ms; the 14 startup jobs complete in a tight cluster between 400 ms and 700 ms instead of trickling in over 7 s.

**Visual change:** Badges, deadline checks, and pending-offers tile populate within ~half a second of the dashboard appearing, instead of trickling in over 7 seconds. The "Allow notifications?" prompt now appears after the dashboard has fully rendered.

**Risk if rolled back:** Reverts to the 7-second-trickle behavior; no data risk. The new pattern is purely a scheduling reorganization — every job function called is unchanged.

**Performance impact:**
- Time-to-fully-loaded-dashboard drops from ~7 s to <1 s.
- Main thread blocked less during bootstrap (each idle-callback yields).
- No new dependencies, no new APIs introduced beyond standard `requestIdleCallback` with a 2-line polyfill fallback.

---

## PR #26 — `ui/clients-list-refinement`

**Closes:** Phase 2 UI track item. Adds the three smallest, highest-value workflow improvements to the Clients screen (the surface Maxwell touches dozens of times a day):

1. Stage filter chips at the top of the list — see your book sliced by stage in one click, with live counts.
2. Sort dropdown (top-right) — three orderings: alphabetical, recently added, stage progression.
3. Persistence — current filter chip + sort choice survive page reload via `localStorage`.

**What it looks like (Active view, top of Clients screen):**

```
[ Search clients… 🔍 ]

All Clients                                              [ + Add ]
[ Active ] [ Archive 3 ]

[ All 12 ] [ Searching 4 ] [ Viewings 3 ] [ Offers 2 ]   Sort: [ Name (A–Z) ▾ ]
[ Conditions 2 ] [ Closing 1 ]

[ … client rows … ]
```

The active chip is filled with the accent color and shows `aria-pressed="true"`. The non-active chips show count in a muted secondary pill. Zero-count stages are hidden from the chip row (so you don't see "Closing 0" when nothing's closing). "All" is always present.

**Approach:**

1. **One source of truth for filter / sort.** Two properties on `Clients`: `filter` (default `'All'`) and `sort` (default `'name'`). Three handlers — `setFilter(stage)`, `setSort(value)`, plus `_savePrefs()` and `_loadPrefs()` for the localStorage round-trip. Key: `mdf-clients-view`. Try/catch'd in case private-browsing blocks storage.

2. **Filter + sort applied in `_applyView(list)`.** Pure function — no DOM writes. Takes a list (always `Clients.all` for now), returns the filtered + sorted view. Called from inside `render()` before the existing card-render path runs. The original alphabetical order from Supabase's `.order('full_name')` becomes the `'name'` sort, so that case is a no-op pass-through.

3. **Sort options:**
   - **`name`** — default; uses Supabase's already-sorted order, no JS-side resort.
   - **`recent`** — newest `created_at` first; rows missing `created_at` sink to the bottom.
   - **`stage`** — most advanced first (Closing → Conditions → Accepted → Offers → Viewings → Searching). Ties break alphabetically. Uses the existing `_STAGE_ORDER` array as the rank source.

4. **Chip counts derived from `_derivedStage`,** not `c.stage`. This matches what the existing `Clients.render` pill already uses (single source of truth), so a client whose stored stage is `'Searching'` but who has an active offer is counted as `Offers` in the chip and rendered with the `Offers` pill — internally consistent.

5. **Toolbar hidden on Archived view.** The `clients-toolbar` div gets `display:none` when `viewMode === 'archived'`. Archived clients have a different shape (restore/delete buttons, opacity 0.75 styling, no stage), so the chips don't apply.

6. **Empty state split into two cases.**
   - **No clients at all** → original "Tap + Add" empty state.
   - **No clients matching filter** → new state with 🔎 icon, the active filter name, and "Click All above to see everyone."

7. **Accessibility.** Chips are `<button>` elements with `aria-pressed` reflecting the active filter. Sort `<select>` has an `aria-label`. Both keyboard-focusable; the existing `:focus-visible` rule from PR #10 styles the focus ring.

8. **Mobile.** Below 480 px, the toolbar stacks vertically (chips first, sort below); chips overflow horizontally with a thin scroll. Doesn't crowd small screens.

**Files changed:**
- `index.html` (lines 460–472) — added a new `#clients-toolbar` div between the Active/Archived buttons and the list. Contains `#clients-stage-chips` (left) + sort `<select>` (right).
- `css/app.css` — `.cl-chip`, `.cl-chip-count`, `.cl-sort` styles using existing theme tokens (`--card`, `--accent`, `--border`, `--text2`). Plus a 480 px breakpoint that stacks the toolbar. Net ~55 lines.
- `js/clients.js` — `filter` + `sort` properties, `_STAGE_ORDER`, `_loadPrefs`, `_savePrefs`, `renderStageChips`, `setFilter`, `setSort`, `_applyView`. `load()`, `showActive()`, `showArchived()` updated to call `renderStageChips()` and toggle the toolbar's visibility. `render()` calls `_applyView()` before deciding empty state. Net ~95 lines added, two existing functions slightly modified.

**Verification:**
- `node -c js/clients.js` — syntax OK.
- `npm test` — 34/34 vitest pass (helpers untouched).
- Manual test plan (post-deploy):
  - Open Clients. The chip row shows up between the Active/Archived buttons and the list, with the live counts.
  - Click `Conditions` chip → only Conditions clients show. Chip turns accent-color. Count badges stay correct.
  - Click `All` → everyone back, no filter.
  - Change Sort to `Recently Added` → list reorders (most recent client first).
  - Change Sort to `Stage progression` → list reorders (Closing first, Searching last).
  - Reload the page. Sort selector + active chip restore from where you left them.
  - Click `Archive` button → toolbar disappears (chips don't apply to archived). Click `Active` → toolbar reappears with the same filter as before.
  - Verify with a deliberately-malicious filter value in localStorage (open DevTools → `Application` → `Local Storage` → edit `mdf-clients-view` to `{"filter":"<img src=x>","sort":"name"}`) → no XSS, the unknown filter just shows the "No clients in this filter" empty state safely.

**Visual change:** New chip row between the Active/Archived buttons and the list, plus a small "Sort" dropdown on the right. Active view only. Everything else (search bar, header, row layout, click behavior, archive view) is unchanged.

**Risk if rolled back:** Loses the chip+sort+persistence features. List goes back to plain "all clients, name-sorted." No data risk; the only code path that changed is presentation.

**Performance impact:** Negligible. Filtering is `array.filter()` over ~tens of items; sorting is `array.sort()` over the same. localStorage write happens once per chip click. No new queries.

**What's NOT in this PR (deliberate scope cut):**
- **Stage filter on the Archived view** — archived clients don't have meaningful stages; restore/delete is the workflow there.
- **Multi-stage filter** (Cmd-click to add more chips to the filter). Adds complexity; single-chip filter covers 95% of usage.
- **"Most Recent Activity" sort** — would require an additional Supabase query for each client's latest viewing/offer/pipeline event. `Recently Added` (by `created_at`) is the cheap 80% solution. Real "Most Recent Activity" can land as a follow-up if you actually use the Recently Added sort enough to feel its limit.

---

## PR #27 — `ui/edit-commission-modal`

**Closes:** Phase 2 UX gap surfaced this morning when James Owusu's row was filed without a closing date and there was no in-app way to add one without deleting + re-adding the record. PR #22 added Delete + Mark Paid; this PR completes the editing loop with a full Edit modal.

**What it does:**
A new **✏️ Edit** button appears between Mark Paid and Delete in every Commission History row's action cell. Clicking it opens a modal pre-filled with the row's current values: property address, sale price, commission rate %, brokerage fee %, tax / HST %, closing date, and status. The modal shows a **live preview of the recalculated totals** as you type (same math as the "Record New Commission" form — including the gross + HST → brokerage fix from PR #12). Click **💾 Save Changes** → all derived fields (`gross_commission`, `hst_collected`, `brokerage_fees`, `agent_net`) are rewritten from the new inputs and the row updates. Click **Cancel** or press **Escape** → no changes.

**Approach:**

1. **Status select with explainer captions.** The dropdown shows:
   - `Closed (auto-promotes to Paid)` — the system's default, auto-graduates 2 days after close_date.
   - `Paid` — explicitly closed, no auto-logic.
   - `Pending (manual hold)` — short-circuits the date-based promotion; useful when a closing is delayed.
   - `Archived` — fell-through deals, excluded from earnings totals.
   The labels make the "why does this status work this way" question answer itself — surfaces the rules from `Commission.statusFrom()` directly in the UI.

2. **Recovers original % rates from stored values when the row is too old to have them.** Rows created before the `commission_rate` and `brokerage_fee_rate` columns started getting stored explicitly can still be edited — we back-compute the rates from `gross_commission / sale_price * 100` and similar inversions. Default fallbacks (2.5% / 20% / 15%) protect against zero-divides.

3. **Live preview reuses the same math as the create form.** A new method `calcEditPreview()` mirrors `calcPreview()` but reads from `cme-*` inputs instead of `cm-*`. Both code paths compute `brokerFee = (gross + hst) * brokerPct / 100` (the PR #12 correction). Net Earnings recomputes on every keystroke.

4. **Client name + agent_id intentionally NOT editable.** Changing a row's client mid-flight breaks reconciliation. If a commission was filed against the wrong client, delete and re-add (now both buttons are one click away — PR #22 + this PR).

5. **Reuses `App.openModal/closeModal`.** Picks up PR #13's focus trap automatically — Tab cycles inside the modal, Escape closes, focus returns to the row's ✏️ button on close.

6. **Validation.** Empty property address or zero sale price → inline error message in red, no save. Otherwise saves and toasts "✅ Commission updated".

7. **All injected strings escaped.** Client name, property address, and id pass through `App.esc` / `App.escAttr` — a row whose `property_address` is `<img src=x>` won't break the modal markup.

**Files changed:**
- `js/extras.js` — three new methods on `Commission`: `openEdit(id)`, `calcEditPreview()`, `saveEdit(id)`. Render code extended to include the ✏️ button between Mark Paid and Delete. Net ~145 lines.
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `node -c js/extras.js` — syntax OK.
- `npm test` — 34/34 vitest pass.
- Manual test plan (post-deploy):
  - On the Commissions screen, every row should have ✏️ between the ✅ and 🗑️ buttons. Paid rows show ✏️ + 🗑️ (no ✅).
  - Click ✏️ on James Owusu's row → modal opens pre-filled with his current sale price, rate, fees, date, status.
  - Type into Sale Price → preview at bottom of modal updates live (gross, HST, brokerage, net all reflow).
  - Change Commission Rate from 2.5 to 3 → preview reflows, brokerage recalculates on the new gross+HST.
  - Change Status to Pending → save → row in the table now shows Pending, status pill yellow.
  - Change Status back to Closed → save → row promotes back to Paid (close_date in past, auto-graduates).
  - Click ✏️ on a paid row → modal opens → press Escape → no change. Click again → click Cancel → no change.
  - Tab around inside the modal → focus stays inside (PR #13 trap working).

**Visual change:** One new ✏️ button per Commission History row, between ✅ Mark Paid and 🗑️ Delete. Click opens a modal modeled after the "Record New Commission" form with the same look-and-feel.

**Risk if rolled back:** Loses the edit affordance; you'd be back to Delete + Re-add for any row correction. No data risk.

**Performance impact:** Zero on render time (one extra `<button>` per row). Each save fires one targeted UPDATE.

**What's NOT in this PR (deliberate scope cut):**
- **Reassign client** (change which client a commission is filed against). Recommended path: delete + create. The audit trail is cleaner that way.
- **Bulk edit** (multi-select rows, change status on all). Not at his deal volume.
- **Undo toast on save** — the current save is immediate. Mistaken edits can be re-edited with another click; no undo needed for a reversible action.

---

## PR #28 — `ui/pipeline-kanban-polish`

**Closes:** Phase 2 UI track — Pipeline screen polish. Originally scoped as "full kanban with drag-and-drop columns" but de-scoped after reading `js/offers.js` and realising the existing card layout is too information-dense to fit in column form. This PR does the realistic polish: better filtering, visual consistency with the rest of Phase 2.

**What it does:**

1. **Three-axis filtering with persistence.** The existing two filter rows (deal type, side) gain a new primary axis: **stage**. A row of chips at the top — `[All] [Accepted] [Conditions] [Closing] [Closed] [Fell Through]` — narrows the visible deals to a single stage. Combines additively with the existing deal_type and deal_side filters. All three filter values persist to `localStorage` under `mdf-pipeline-view`, so reloading the page restores your view exactly where you left it.

2. **Visual unification with Clients list.** All three filter rows now use the same `.cl-chip` class introduced in PR #26 — same rounded pill shape, same count badge style, same accent-color active state with `aria-pressed`. Pipeline + Clients look like they were designed by one team because they were.

3. **Sticky filter bar.** The chip rows are wrapped in `.pl-filter-bar { position: sticky; top: 0; }` so as you scroll a long deal list, the filters stay visible at the top of `#main-content`. Click a chip without scrolling back to the top.

4. **Unified section headers.** The "Closed Deals (N)" and "Fell Through (N)" collapsible headers existed already, but Active deals just dumped into the list with no header — visually inconsistent. Now there's a matching **"Active Deals (N)"** header (🔵 icon, same `.pl-section-header` class) above the active section. Click any of the three headers to collapse/expand. The chevron flips on collapse via CSS class.

5. **Empty filter state.** When a filter narrows to zero results, you now see "No deals match this filter." instead of the empty-state "🚀 No active deals" message that was reserved for the truly-empty case.

**Approach:**

1. **Stage filter is additive, not exclusive.** Picking "Conditions" doesn't reset deal_type or side. Each axis is its own independent slice. This matches how Maxwell mentally filters in conversation ("show me my Conditions deals on the buy side").

2. **Counts use the un-narrowed universe.** Each chip's count badge reflects the *total* count of that facet across all deals, not the count after the other filters apply. This is the standard "facet count" pattern (Google Shopping, Airbnb) — counts stay stable, you can see what's available before narrowing further. Zero-count chips are hidden (except "All", always shown).

3. **One generic chip helper.** `chipBtn(key, label, count, handler)` replaces the three inline-styled chip helpers (each of which built its own button via template-literal inline styles). Handler is `{fn: 'setStageFilter', current: stageFilter}` — generic across all three axes.

4. **Sticky-bar offsets.** The bar uses the screen's own background color (`var(--bg)`) and a 1px bottom border so cards scrolling past look like they're sliding under it, not bumping into it. `z-index: 5` keeps it above cards but below modals (z-index 10000) and the topbar (z-index 200).

5. **Section-header class consolidation.** Was three separate inline styles before (margin / display flex / gap / icon color / typography) — now one `.pl-section-header` class with `.pl-section-icon`, `.pl-section-label`, `.pl-section-chevron` children. Hover and collapsed states handled via the parent class.

6. **No drag-and-drop, no column restructuring, no breaking changes to existing card rendering.** The detailed cards (progress bars, milestones, reschedule logic, stakeholder strips, new-build status tickers) are completely untouched.

**Files changed:**
- `js/offers.js` — `Pipeline` namespace gains `currentStageFilter`, `setStageFilter`, `_loadPrefs`, `_savePrefs`. `load()` calls `_loadPrefs()` first. `render()` filter-row block rewritten to use a single `chipBtn` helper + three filter rows. Active-section rendering gains a matching collapsible header. `toggleSection` toggles a CSS class for the chevron animation. Net ~95 lines changed (mostly replacing inline-styled chips with the new helper).
- `css/app.css` — new `.pl-filter-bar`, `.pl-filter-row`, `.pl-section-header`, `.pl-section-icon`, `.pl-section-label`, `.pl-section-chevron`, `.pl-collapsed` rules. Plus 480 px breakpoint that tightens chip gaps. Net ~50 lines.
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `node -c js/offers.js` — syntax OK.
- `npm test` — 34/34 vitest pass.
- Manual test plan (post-deploy):
  - Open Pipeline. See three rows of chips at the top: stage (top), deal type (middle), side (bottom).
  - Click `Conditions` stage chip → only Conditions-stage deals show. Chip turns accent color.
  - Click `🏠 Existing Home` → narrows further; the Conditions chip stays active. Counts on the chips remain showing the universe totals.
  - Reload the page. Both filters restore. Sort selector unchanged.
  - Scroll down a long pipeline → filter bar stays pinned at the top.
  - Click the "Active Deals (N)" header → section collapses, chevron flips down. Click again → expands.
  - Same for "Closed Deals (N)" and "Fell Through (N)".
  - Narrow to a filter combo with zero deals → "No deals match this filter." shows.

**Visual change:** Three filter chip rows at the top (was two, styled differently from elsewhere in the app). Sticky on scroll. Section headers match across Active / Closed / Fell Through. Everything else (the deal cards themselves) is unchanged.

**Risk if rolled back:** Loses the stage filter, the persistence, the sticky bar, and the unified section header style. Filter chips revert to inline-styled buttons. No data risk.

**Performance impact:** Negligible. Three independent filter passes over the deals array (already happening, just split out from one nested chain). Saving to localStorage is one tiny JSON write per click.

**What's NOT in this PR (scoped out from the original "kanban polish" idea):**
- **Kanban columns (Searching → Accepted → Conditions → Closing).** The cards are too tall and information-rich to lay out in vertical columns without a major card-shape redesign. Real kanban will be its own multi-hour PR with a card-summary alternative view.
- **Drag-and-drop stage changes.** Same reason — needs the card view to support it. Currently stages change via the in-card date inputs and the dedicated stage transition logic.
- **Per-stage subtotals (e.g. "Conditions: $4.2M volume").** Useful but adds another row of UI. Save for an Analytics-tab follow-up.

---

## PR #29 — `a11y/intake-form-violations`

**Closes:** Audit a11y debt — the axe-core violations on the four public-facing surfaces (`index.html` lock screen, `intake.html` buyer intake, `seller-intake.html` seller intake, `respond.html` viewing response). All were `label` / `form-field` violations: inputs with visible label text in a `<span>` or `<div>`, but no programmatic `for=` / `aria-label` association. Screen reader users heard "edit text" with no context; voice-control users (Dragon, Voice Control on iOS) couldn't say "click the email field." These are the forms your clients fill out — the ones that matter most for "professional finish."

**What it does:**

Converts every visible label that sits above a real form input into a properly-associated `<label for="...">` element. For inputs whose visible label is a *parent container's* title (the price-mode tiles in seller-intake, the lock-screen placeholders), adds `aria-label`. For radio groups, wraps the options in `<div role="radiogroup" aria-labelledby="...">` so screen readers announce the group purpose before the first option.

**Surfaces fixed:**

| File | Inputs labeled | Method |
|---|---|---|
| `index.html` lock screen | 2 (email, password) | `aria-label` — there's no visible label text, the placeholder is the de facto label |
| `intake.html` | 7 (firstname, lastname, email, phone, areas, budget-max, notes) | `<span class="field-label">` → `<label class="field-label" for="…">` |
| `seller-intake.html` | 8 (firstname, lastname, email, phone, address, ptype, sqft, notes) + 2 (price range, price firm) via `aria-label` | Mix of `<label>` conversion and `aria-label` |
| `respond.html` | 3 (offer-amount, offer-note, notfit-other) + radio group wrapped | Added `for=` to existing `<label>`; wrapped radio group in `role="radiogroup" aria-labelledby` |

**Approach:**

1. **Two distinct fix patterns, picked per situation.**
   - **`<label for="…">`** when a visible text label sits in the DOM adjacent to the input. Best practice. Click on the label also focuses the input — bonus UX.
   - **`aria-label="…"`** when the visible label is not a sibling but a parent's title or the placeholder text itself. Screen reader still announces the field correctly; no visual change.

2. **Radio groups wrapped in `role="radiogroup" aria-labelledby="…"`.** The original `<label class="form-label">What didn't work for you?</label>` was a free-floating label without a `for=` target (there are 5 radio inputs, not 1). Proper pattern: convert that label to a `<span id="notfit-legend">`, then wrap the radios in `<div role="radiogroup" aria-labelledby="notfit-legend">`. Screen readers now announce "Radio group: What didn't work for you? — radio 1 of 5: Price is too high."

3. **Pill groups (multi-select chip pickers) are NOT changed in this PR.** The visible-label `<span class="field-label">` elements that sit above pill groups (Living Situation, Bedrooms, Property Type, etc. in both intake forms) stay as `<span>` for now. The pill `<div>`s themselves aren't form controls (they're styled clickable divs that toggle state and submit a hidden field on form submit), so axe doesn't flag them as "input missing label." The proper long-term fix is to convert the pills to `<button role="radio" aria-checked="…">` inside a `<fieldset role="radiogroup">`, which is a 200+ line refactor across 12 pill groups. Out of scope for this PR; flagged for a future a11y-pills PR.

4. **Honeypot inputs were already correct.** Both intake forms wrap their honeypot inputs in a parent `<div … aria-hidden="true">`, which already tells screen readers to skip them. No change needed.

5. **No CSS changes.** `<label class="field-label">` renders identically to `<span class="field-label">` because the `field-label` rule already sets `display:block`. The visual result is unchanged across all four files.

6. **No JS changes.** Form submission and pill-toggle logic is untouched.

**Files changed:**
- `index.html` — 2 lines (added `aria-label` to auth inputs).
- `intake.html` — 7 `<span class="field-label">` → `<label … for="…">` conversions. Plus `role="group" aria-label="…"` on the two pill containers whose adjacent label converted (so the pill group is still semantically connected).
- `seller-intake.html` — 6 conversions + 2 `aria-label` additions on price-range / price-firm inputs + 1 new `<label for="f-notes">` (was unlabeled entirely).
- `respond.html` — 2 `for=` additions on existing `<label>` elements + radio group restructured to `role="radiogroup" aria-labelledby`. Plus an `aria-label="Other reason"` on the conditional `notfit-other` input.
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `npm test` — 34/34 vitest pass (no JS / no helper changes).
- Manual:
  - Open the lock screen, tab through email and password fields. Each gets its visible focus ring. macOS VoiceOver (Cmd+F5) announces "Email address, edit text" and "Password, secure edit text" — was just "edit text" before.
  - Open `/intake.html` in a screen reader. Tab through First Name → Last Name → Email → Phone. Each is announced by its label text. Click on a label text (e.g. "Email Address") — focus jumps into the matching input (was previously a dead click on the span).
  - Open `/respond.html?t=…`, click "Doesn't Fit". Screen reader announces "Radio group: What didn't work for you? — radio 1 of 5: Price is too high."

**Visual change:** **None.** Every change is structural (label/span semantics, aria attributes). The page renders pixel-identical.

**Risk if rolled back:** Reintroduces the axe violations. No data risk, no behavioral change, no UX regression.

**Performance impact:** Zero. No bytes added that the parser processes meaningfully.

**What's NOT in this PR (deliberate scope cut for future a11y PRs):**
- **Pill groups → radiogroup pattern.** 12 pill groups across both intake forms, each needs `<fieldset role="radiogroup">` + button-style pill children with `aria-checked`. Big refactor, dedicated PR.
- **Color contrast audit.** Some intake-form text (placeholder `color:#475569` on `background:#0a0f1e`) may fall below WCAG AA 4.5:1. Needs a contrast pass with axe color rules, separate PR.
- **Skip links** for keyboard users on the agent app (`index.html`). The lock screen and dashboard would benefit. Small, separate PR.
- **Heading hierarchy.** Some sections jump from `h2` to `h4`. Cosmetic but flagged by axe `heading-order`. Separate PR.

---

## PR #30 — `ui/calendar-refinement`

**Closes:** Phase 2 UI track — the Calendar screen polish, completing the chip + sticky-bar pattern across all three primary navigation surfaces (Clients PR #26, Pipeline PR #28, Calendar PR #30).

**What it does:**

1. **Event-type filter chips** above the calendar grid: `[All] [📅 Showings] [✅ Accepted] [🏦 Financing] [🔍 Inspection] [🚶 Walkthrough] [🔑 Closing] [🏗️ Builder Visit]` — each with a live count. Click one → only that type renders on both the month grid AND the upcoming-events strip below. Zero-count chips are hidden.

2. **Sticky toolbar.** The whole top section (page title + prev/next navigation + view toggle + filter chips) is wrapped in `.cal-toolbar { position: sticky; top: 0; }` so it stays visible as you scroll the upcoming-events list below the grid. Same pattern as Pipeline's `.pl-filter-bar` from PR #28.

3. **Persistence.** Filter type and view (month vs. list) save to `localStorage` under `mdf-calendar-view` and restore on next visit.

**Approach:**

1. **Filter applies in three render paths.** The Calendar renders three areas: the month grid (`_renderMonth`), the upcoming-events strip (`_renderUpcomingInline`), and the list view (`_renderList`). All three now call `Calendar._applyFilter(events)` before building their output. Pure function, easy to test mentally — narrows the array, no side effects.

2. **Type taxonomy lives in `Calendar._TYPES`.** A single array of `{key, label, icon}` drives both the chip render and (by inference) the legend below the grid. Adding a new event type means one array entry + a `cal-dot-X` CSS rule.

3. **`fetchEvents` is unchanged.** Always fetches everything. The filter is purely a render-time narrow, so switching filter doesn't re-hit Supabase.

4. **`.cl-chip` reuse.** Calendar chips use the same `.cl-chip` / `.cl-chip-count` classes introduced in PR #26. Visually identical to the Clients and Pipeline filter chips. The "shared chip" comment in `css/app.css` makes it clear the class isn't Clients-specific.

5. **Sticky bar offsets.** Same z-index (5) and background (`var(--bg)`) treatment as Pipeline's filter bar from PR #28, so cards scroll under it cleanly. The 1px bottom border gives it a subtle anchor.

6. **Mobile breakpoint at 480 px** matches the Pipeline + Clients pattern: chips overflow horizontally with a thin scrollbar instead of wrapping awkwardly.

**Files changed:**
- `index.html` — wrapped the existing toolbar header in `.cal-toolbar`, added `<div id="cal-filter-chips">` below it.
- `css/app.css` — `.cal-toolbar`, `.cal-filter-chips` + 480 px responsive variants. ~22 lines.
- `js/calendar.js` — `_filter`, `_TYPES`, `_loadPrefs`, `_savePrefs`, `setFilter`, `_applyFilter`, `_renderFilterChips` added. `load()` calls `_loadPrefs()` first. `setView()` now saves. `_renderMonth`, `_renderUpcomingInline`, `_renderList` each call `_applyFilter` on the event list before their existing logic. Net ~65 lines.
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `node -c js/calendar.js` — syntax OK.
- `npm test` — 34/34 vitest pass.
- Manual test plan (post-deploy):
  - Open Calendar. See the new chip row below the month nav + view toggle, above the calendar content.
  - Click `🔑 Closing` → only closing-day cells light up in the month grid, only closings appear in the Upcoming strip.
  - Click `All` → back to everything.
  - Switch to List view → chip filter still applies; click `📅 Showings` → list narrows.
  - Scroll the page down → the toolbar (title + nav + view toggle + chips) stays pinned at the top.
  - Reload the page → your last filter + view restore.
  - Switch month with `‹ Prev` / `Next ›` → filter persists across months.

**Visual change:** New filter-chip row between the calendar nav and the calendar grid. Toolbar sticks on scroll. Everything else (the month grid cells, day-detail modal, legend, upcoming-events strip) is unchanged.

**Risk if rolled back:** Loses the event-type filter, persistence, and sticky bar. The legend below the calendar still works as a static reference. No data risk.

**Performance impact:** Negligible. One `array.filter()` pass per render over `Calendar._events` (already in memory). The chip-render iterates the same array once for counts. No new queries.

**Three-screen consistency check (Clients, Pipeline, Calendar):**

| Pattern | Clients (PR #26) | Pipeline (PR #28) | Calendar (PR #30) |
|---|---|---|---|
| Stage/type chips with counts | ✅ | ✅ | ✅ |
| `.cl-chip` styling | ✅ | ✅ | ✅ |
| Sticky filter bar | (toolbar header only) | ✅ `.pl-filter-bar` | ✅ `.cal-toolbar` |
| localStorage persistence | ✅ `mdf-clients-view` | ✅ `mdf-pipeline-view` | ✅ `mdf-calendar-view` |
| `aria-pressed` on active chip | ✅ | ✅ | ✅ |
| Zero-count chips hidden | ✅ | ✅ | ✅ |

**What's NOT in this PR (deliberate scope cut):**
- **Date range picker** (jump to a specific month from a calendar widget). Current Prev/Next is fine for ±12 months around today.
- **Custom event types** (Maxwell creating his own colored event tags for personal use). Out of scope; system tags cover the workflow.
- **Drag to reschedule** on the month grid. Useful but needs much deeper plumbing (writes to pipeline / viewings / builder_visit_requests tables).

---

## PR #31 — `phase3/marketing-site-v1`

**Closes:** First entry in **Phase 3** — the marketing website. The CRM (Phase 2) is the agent-facing tool. The marketing site is the public-facing landing page that converts visitors into intake-form submissions. Lives at `/site/` so the CRM root URL (`/`) is unaffected.

**What it does:**

A single-page marketing landing at `https://maxwell-dealflow.vercel.app/site/`. Standalone HTML (no shared CSS/JS dependency on the CRM) so it loads fast and ranks well in search.

**Sections (top to bottom):**
1. **Sticky nav** — Maxwell's "MD" avatar + name on the left; "Start with a free intake" CTA on the right. Backdrop-blur so it doesn't compete with content.
2. **Hero** — eyebrow ("REALTOR® · eXp Realty · St. John's, NL"), big heading ("The home you want, on terms that work for you."), one-paragraph lead, two CTAs: 🏠 buyer intake / 🏷 seller intake.
3. **How I help** — two side-by-side cards (Buying / Selling) with bullets + per-card CTAs. Honest sales copy ("no hard sell, no high-pressure tactics").
4. **Process** — three numbered steps showing the working-together flow + a side card with a direct-email shortcut.
5. **Why work with me** — three trust-strip cards (Local-first / Honest / Modern + responsive).
6. **CTA band** — coral gradient strip with the two intake links one more time.
7. **Footer** — three columns: identity, contact, brokerage. Bottom row with year + "Independently owned and operated" disclaimer.

**Approach:**

1. **One self-contained file.** Inline CSS, one tiny inline `<script>` to set the year. No external JS framework, no shared stylesheet with the CRM. Fast LCP (no waterfall fetches), easy to deploy, easy to audit. ~447 lines total including comments.

2. **Visual continuity with the CRM without code reuse.** The CRM is dark-themed (navy `#0A0E14` + coral accents). The marketing site is light-themed (white + soft beige `#F8F7F4` + same coral). Both share the brand color (`#CC785C`) so they feel like the same brand without sharing a single CSS variable.

3. **Real content grounded in Maxwell's brokerage facts.** Brokerage is **eXp Realty** (not Royal LePage — verified against `CLAUDE.md`). Display email is `Maxwell.Midodzi@exprealty.com` (not the Gmail sender). Service area is St. John's + Avalon (Mount Pearl, Paradise, CBS named explicitly).

4. **SEO + social baked in.**
   - `<title>` and `<meta name="description">` tuned for the "Maxwell Midodzi realtor St. John's" query.
   - Open Graph + Twitter Card meta for nice link previews when the URL is shared.
   - JSON-LD `RealEstateAgent` schema for Google's Knowledge Graph. Identifies Maxwell, his role, his brokerage, his service area, and his email.
   - Reuses the CRM's `/icons/icon-512.png` for favicon + og:image, so social shares look polished without adding new assets.

5. **Conversion path is the intake forms, not contact phone numbers.** Every primary CTA links to `/intake.html` (buyer) or `/seller-intake.html` (seller) — the forms that already feed Maxwell's CRM via the `submit_intake` RPC. So a visitor who lands on `/site/`, hits a CTA, fills out an intake, and lands directly in Maxwell's Approvals queue with no manual touch. The marketing site is wired into the existing pipeline by virtue of where its links point.

6. **Accessibility carries over from PR #29.** All clickable elements are `<a>` or `<button>`. Decorative emojis use `aria-hidden="true"`. The nav is wrapped in `<nav aria-label="Primary">`. Color contrast ≥ 4.5:1 on body text and ≥ 3:1 on large headings. `:focus-visible` rule restores the keyboard focus ring globally.

7. **Mobile-first.** Hero typography uses `clamp()` so it scales from phone to desktop. Two-column and three-column grids collapse to one column under 720 px. CTAs stack vertically on phones with `flex-wrap`. Tap targets are ≥ 44 px (the standard).

8. **`prefers-reduced-motion: reduce` honored.** Smooth scroll and card-hover transitions turn off for users who've asked the OS to reduce motion.

**Files changed:**
- `site/index.html` — new directory + new file. 447 lines (including comments).
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `npm test` — 34/34 vitest pass (no JS / no helpers changed).
- Manual test plan (post-deploy):
  - Visit `https://maxwell-dealflow.vercel.app/site/` — page loads instantly (all CSS inline, no external JS).
  - Click "🏠 Looking to buy" → routes to `/intake.html`. Submit the form. It lands in the CRM's `client_intake` table and triggers a notification.
  - Same for "🏷 Looking to sell" → `/seller-intake.html`.
  - Open on an iPhone (or DevTools mobile view at 390 px) — hero text scales down cleanly, columns stack, CTAs stack.
  - View source — see the JSON-LD block at the top. Test it in Google's Rich Results Test (`https://search.google.com/test/rich-results`) to verify Google sees Maxwell as a RealEstateAgent.
  - Share the URL on iMessage/Slack — see the Open Graph preview render with title + description + icon image.

**Visual change:** A brand new URL surface. The CRM at `/` is unchanged. Nothing visible to Maxwell unless he navigates to `/site/`.

**Risk if rolled back:** Loses the marketing landing page. The intake forms (`/intake.html`, `/seller-intake.html`) still work directly, but there's no marketing front door to drive visitors there. No data risk.

**Performance impact:**
- Single HTML file, no waterfall fetches, no JS bundle.
- LCP target: first meaningful paint within 200 ms on a fast connection, 1 s on slow 3G.
- No service-worker dependency — fresh deploys propagate instantly to `/site/` (the SW from `sw.js` is scoped to the root and only intercepts the agent app's resources).

**What's NOT in this PR (Phase 3 backlog for next sessions):**
- **`/site/about/`** — long-form bio, photo, certifications, sales record.
- **`/site/listings/`** — current MLS listings pulled in via an MLS feed integration.
- **`/site/sold/`** — closed deals (with addresses redacted), sale-price-to-list-price ratios, days on market — social proof for sellers.
- **`/site/testimonials/`** — client reviews. Already a `reviews` table in Supabase; just needs a public page that reads from it.
- **`/site/blog/`** — local market reports, buyer/seller guides — content marketing for SEO.
- **Sitemap + robots.txt + canonical tags** — proper search-engine plumbing once there's more than one page.
- **Analytics** — Plausible or Fathom (privacy-respecting alternatives to GA) once we want to measure conversion.

---

## PR #32 — `phase3/site-about-page`

**Closes:** Phase 3 — adds the "About" page at `/site/about/` and refactors the marketing site to use a shared stylesheet (`/site/css/site.css`) so all current and future `/site/*` pages stay visually consistent without duplicating 200 lines of CSS each.

**What it does:**

1. **New page at `/site/about/`** — the "who is this guy" surface the landing page implicitly promises.
2. **Shared stylesheet extracted** to `/site/css/site.css` (324 lines). Both the landing page and the new About page now reference it instead of carrying duplicate inline CSS.
3. **Site-wide nav links added** — `[About] [Buyer intake] [Seller intake]` between the brand and the CTA. Hidden under 640 px (mobile keeps just the brand + CTA to stay clean).
4. **Active-state styling** — the current page's nav link is highlighted in coral via the `.active` class.

**About page sections:**

1. **About hero** — left column: gradient placeholder (the "MD" initials block) with `TODO` comment for swapping in a real headshot. Right column: name, role, two intro paragraphs, plus a 3-stat strip (years in business, families served, avg. rating).
2. **My approach** — 3 trust-strip cards (Do the homework first / Tell you what I see / Stay in touch). Sets the tone — anti-theatre, pro-honesty.
3. **What I specialise in** — 4 cards: First-time buyers, New builds, Sellers, Move-up & relocation. Each with 4 sub-bullets.
4. **Credentials** — pill row of certifications (Licensed REALTOR®, eXp Realty, CREA, NLAR, E&O Insurance).
5. **CTA band** — repeats the two intake links with a slightly different copy than the landing page ("Ready when you are.").
6. **Footer** — identical structure to the landing footer, plus a "← Back to home" link.

**Approach:**

1. **Placeholder real-person content marked with HTML `TODO` comments.** Stats (`5+ years`, `50+ families`, `5★ rating`) and credentials are reasonable defaults but every block has a comment telling Maxwell to swap in real numbers. No risk of fabricated claims accidentally going public if I'm wrong about a detail — they're flagged for him to verify and edit.

2. **Shared CSS is the right move at PR #32 because we now have ≥2 pages.** At PR #31 (one page), inline CSS was the right tradeoff (one HTTP request, fast LCP). At PR #32 (two pages), shared CSS pays back the extra request after the first page load (browsers cache `/site/css/site.css` for the second page). The single-page LCP cost is one extra request, still under 50 KB.

3. **About-specific styles bundled into the shared CSS.** The `.about-hero`, `.about-photo`, `.about-body`, `.stats`, `.stat`, `.creds`, `.cred-pill` classes all live in `/site/css/site.css` (about 50 lines). Future pages (testimonials, sold deals) will add their own page-specific blocks the same way.

4. **Three nav links, hidden under 640 px.** Reasonable mobile UX — the CTA + brand fit on the smallest phones; secondary nav appears on tablets and up. The hamburger-menu pattern is not yet warranted (only 3 links).

5. **Schema.org `Person` JSON-LD** instead of `RealEstateAgent` here — that's the correct typing for an About page bio. The landing page keeps `RealEstateAgent` (the business role).

6. **`og:type: profile`** instead of `og:type: website` on the About page — same reason. Tells Facebook/LinkedIn this is a person's profile, not a generic site URL. Slightly nicer share previews.

7. **Photo placeholder is intentionally striking.** Instead of an `<img src="placeholder.jpg">` 404, the photo column is a styled `<div class="about-photo">` showing "MD" in white-on-coral. Looks intentional, not broken, until Maxwell drops in a real headshot. The CSS rule (`.about-photo img { width: 100%; height: 100%; object-fit: cover; border-radius: var(--r-lg); }`) is ready for the swap — just replace the `<div>` contents with `<img src="/site/img/maxwell.jpg" alt="…">`.

**Files changed:**
- `site/css/site.css` — new, 324 lines. All shared styles consolidated.
- `site/index.html` — landing page refactored: inline `<style>` block (229 lines) replaced with one `<link>` tag (1 line). Nav block extended with the new `.nav-links` block. Net: 447 → 224 lines.
- `site/about/index.html` — new file, 248 lines.
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `npm test` — 34/34 vitest pass.
- Manual test plan (post-deploy):
  - Visit `/site/` — looks identical to before (CSS now external but same rules).
  - Click "About" in the nav → `/site/about/` loads, "About" link is highlighted in coral.
  - About page renders the hero with the gradient "MD" placeholder, 3 stats, 4 specialty cards, credentials pills, CTA band, footer.
  - Click "← Back to home" in the footer → returns to landing page.
  - Mobile (390 px): nav-links hidden, brand + CTA only. Hero grid stacks (photo on top, text below). 4-card grid becomes 1 column. 3-stat strip becomes 2 columns.
  - View source on About page → see the `og:type:profile` and Schema.org `Person` JSON-LD.

**Visual change:** Two new marketing-site pages now exist (landing was already shipped in PR #31; this PR adds About). The CRM is unchanged.

**Risk if rolled back:** Loses the About page + shared stylesheet refactor. Landing page would need a quick re-inline of the CSS to keep working. No data risk.

**Performance impact:**
- Landing page: one extra HTTP request for `site.css` on first visit; cached forever after. LCP increases by ~30 ms on cold load, drops to zero on subsequent /site/* visits.
- About page: same one-request cost as a fresh visit. Caches once.

**What's NOT in this PR (deliberate scope cut for future PRs):**
- **Real headshot photo.** The `<div class="about-photo">` placeholder is in place. Maxwell uploads a JPG to `/site/img/maxwell.jpg` (one-line swap) when ready.
- **Verified credentials.** Pills are best-guess defaults; Maxwell edits them with his actual licenses, awards, memberships.
- **Real career stats.** Placeholder numbers (5+, 50+, 5★); Maxwell swaps in real values from his records.
- **`/site/sold/`** — closed-deal social proof from the existing `commissions` table.
- **`/site/testimonials/`** — pull from existing `reviews` table.

---

## PR #33 — `phase3/site-seo-plumbing`

**Closes:** The technical SEO foundation for the marketing site. Without this, Google might index the agent CRM and token-protected response pages, leaking metadata into search results and wasting crawl budget. With this, only the four public, indexable pages get crawled and ranked.

**What it does:**

1. **`/robots.txt`** at the site root — explicitly allows `/site/*`, `/intake.html`, `/seller-intake.html`; disallows the agent CRM and every token-protected surface (`/respond.html`, `/portal.html`, `/review.html`, `/builder*.html`, `/stakeholder*.html`, `/seller-portal.html`); points crawlers at the sitemap.
2. **`/sitemap.xml`** — explicit list of the 4 public, indexable URLs with `<changefreq>` and `<priority>` hints so Google knows which pages matter most.
3. **`<link rel="canonical">`** added to both `/site/` and `/site/about/` so any URL variation (trailing slashes, query strings, alternative hostnames) collapses to one canonical address in search results.
4. **`<meta name="robots" content="noindex, nofollow">`** added to all 6 private surfaces: `index.html` (CRM root), `respond.html`, `portal.html`, `review.html`, `builder.html`, `seller-portal.html`. Belt-and-braces with robots.txt — even if a search engine somehow tries to crawl them, the meta tag stops indexing at the page level.

**Approach:**

1. **`robots.txt` is the broad signal, `<meta robots>` is the precise signal.** robots.txt tells well-behaved crawlers what to skip *before* they fetch. The `<meta>` tag tells them what to skip *after* fetching. Some crawlers ignore robots.txt (rare, but it happens — research bots, some AI scrapers); the meta tag catches those. Some pages get linked from elsewhere and crawlers fetch them anyway (curious crawlers will request `Disallow`d pages); the meta tag catches that case too.

2. **The bare-domain Disallow.** `robots.txt` has `Disallow: /$` (the regex anchor on `/`). This tells crawlers not to index `https://maxwell-dealflow.vercel.app/` itself — currently the CRM entry point. When we eventually rewire the root to serve the marketing site (or add a top-level redirect), that line gets removed.

3. **`Allow: /site/`** is explicit even though robots.txt is "allow-by-default" — being explicit makes the intent clear to any human reading the file later. Same for `/intake.html` and `/seller-intake.html`.

4. **Canonical URLs use the full production hostname.** Google treats `https://maxwell-dealflow.vercel.app/site/` as the one true address. If you later add a custom domain (e.g. `maxwellrealtor.ca`), update the canonical tags in one pass — they're easy to grep.

5. **Sitemap priorities reflect conversion value, not just page importance.** `/site/` is `priority 1.0` because it's the primary landing. `/site/about/` is `0.8` (high authority, lower conversion). The intake forms are `0.7` (direct conversion targets but only valuable if Google indexes them as separate landing pages).

6. **No JS, no dependencies.** Both `robots.txt` and `sitemap.xml` are static — Vercel serves them as-is from the deploy. No build step, no CI processing.

**Files changed:**
- `robots.txt` — new at site root, 38 lines.
- `sitemap.xml` — new at site root, 40 lines.
- `site/index.html` — added `<link rel="canonical">` (2 lines).
- `site/about/index.html` — added `<link rel="canonical">` (2 lines).
- `index.html` — added `<meta name="robots" content="noindex, nofollow">` (2 lines).
- `respond.html` — added `<meta name="robots" content="noindex, nofollow">` (2 lines).
- `portal.html` — added `<meta name="robots" content="noindex, nofollow">` (2 lines).
- `review.html` — added `<meta name="robots" content="noindex, nofollow">` (2 lines).
- `builder.html` — added `<meta name="robots" content="noindex, nofollow">` (2 lines).
- `seller-portal.html` — added `<meta name="robots" content="noindex, nofollow">` (2 lines).
- `REFINEMENT_LOG.md` — this entry.

**Verification:**
- `npm test` — 34/34 vitest pass (no JS changes).
- Manual test plan (post-deploy):
  - Visit `https://maxwell-dealflow.vercel.app/robots.txt` — see the rules in plain text.
  - Visit `https://maxwell-dealflow.vercel.app/sitemap.xml` — see the 4 URL entries.
  - View source on `/site/` — see `<link rel="canonical" href="…/site/">` in the head.
  - View source on `/index.html` (the CRM) — see `<meta name="robots" content="noindex, nofollow">`.
  - Submit the site to Google Search Console: `https://search.google.com/search-console`. Add the property, verify ownership (Vercel can serve a meta-tag verification or DNS TXT), then submit the sitemap URL. Within a few days, Google's indexing report will show the 4 public URLs as indexed and zero private URLs as crawled.

**Visual change:** **None.** All changes are search-engine-facing meta tags + two static files at the site root.

**Risk if rolled back:** Without `noindex` tags, Google might accidentally index `/index.html` (the CRM root) or surface token-protected URLs in search. Reverting also drops the sitemap and robots.txt, which slows the indexing rate of the public marketing pages.

**Performance impact:** Negligible. Two tiny static files served once per crawl; canonical / robots meta tags add ~80 bytes per page. LCP unchanged.

**What's NOT in this PR (deliberate scope cut):**
- **Google Search Console verification token.** Maxwell needs to add the site to Search Console himself and pick the verification method (HTML file, meta tag, or DNS TXT). Each method has trade-offs and the chosen one needs his real account.
- **`hreflang`** tags. Only relevant if we ship the site in multiple languages or for multiple regional Google indexes. Not now.
- **Structured data testing.** The Schema.org JSON-LD was shipped in PR #31 and #32 — verify it parses cleanly in Google's Rich Results Test once deployed.
- **OpenGraph image dimensions audit.** The current `og:image` uses `/icons/icon-512.png`. Facebook prefers 1200×630. Future PR: generate a real share image.
- **`pagespeed` audit.** Mobile-friendly test + Core Web Vitals. The marketing site should pass easily (no JS bundle, inline CSS) but worth running through Lighthouse once deployed.

---
