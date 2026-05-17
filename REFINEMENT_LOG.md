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
