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
