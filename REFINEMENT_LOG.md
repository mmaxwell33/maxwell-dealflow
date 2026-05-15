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

---
