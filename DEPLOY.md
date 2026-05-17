# DEPLOY.md

How to deploy, roll back, apply migrations, and redeploy edge functions for
Maxwell DealFlow. Pulled together from the live-fire ops of the Phase 2
refinement work in May 2026.

## Components

| Component | Where it lives | How it deploys |
|---|---|---|
| Frontend HTML/CSS/JS | Vercel | Auto-deploys on push to `master` (≈ 30-60 s) |
| Supabase migrations | Supabase Dashboard SQL Editor | Manual paste-and-run |
| Supabase edge functions (`supabase/functions/*`) | Supabase | `supabase functions deploy <name>` (Supabase CLI) |
| Supabase secrets (env vars for edge functions) | Supabase Dashboard | Project Settings → Edge Functions → Secrets |
| pg_cron jobs | Supabase | Set inside migration SQL via `cron.schedule(...)` |
| GitHub Actions workflow | `.github/workflows/ci.yml` | Commit to `master` (auto) — but the PAT used for `git push` must have the `workflow` scope to push changes to this file |

## Normal deploy flow (refinement PRs)

1. **Branch + edit:**
   ```bash
   git checkout -b <type>/<short-name>
   # …edits…
   ```
2. **Commit + push:**
   ```bash
   git add <files>
   git commit -m "<type>: short summary (PR #N)"
   git push -u origin <branch>
   ```
3. **Open PR via GitHub web UI** (or `gh pr create` if you have it set up).
   Wait for CI green ✓.
4. **Merge:**
   - Web UI: click "Merge pull request" (use `--no-ff` style if your repo
     setting allows; in this repo the merge-button shape is fine).
   - OR escape-hatch from terminal (used during the 2026 refinement when web
     auth was blocked):
     ```bash
     git checkout master
     git pull
     git merge --no-ff <branch> -m "Merge PR #N: <branch>"
     git push origin master
     ```
5. **Vercel auto-deploys** the HTML/JS/CSS change. Watch the deploy status
   at <https://vercel.com/dashboard> if anything feels wrong.

## When a PR includes a Supabase migration

Run AFTER the PR is merged (so the migration file is on `master`):

1. Copy the file to your clipboard:
   ```bash
   cat ~/Desktop/maxwell-dealflow/supabase/migrations/<NNN>_<name>.sql | pbcopy
   pbpaste | head -3   # sanity check — should show the file's first lines
   ```
2. Open Supabase Dashboard → SQL Editor → **+ New query**.
3. Click into the empty editor area (focus matters — Cmd+V does nothing
   without focus).
4. **Cmd+V** to paste. If Cmd+V fails, **right-click → Paste**.
5. Click the green **Run** button.
6. Expect "Success. No rows returned" (or a small result set if the migration
   selects something at the end).

Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`,
`DROP POLICY IF EXISTS`, etc.) — safe to re-run.

## When a PR includes an edge function change

You need the Supabase CLI:

```bash
# One-time setup
brew install supabase/tap/supabase
supabase login
supabase link --project-ref bxwmbrdndsetjwcexwpc
```

Then for each function changed:

```bash
cd ~/Desktop/maxwell-dealflow
supabase functions deploy <function-name>
# e.g. supabase functions deploy send-push
#      supabase functions deploy claude-chat
#      supabase functions deploy daily-briefing
```

You can verify in Supabase Dashboard → Edge Functions → check the latest
deploy timestamp.

## When a PR changes / adds a secret

Two paths:

### Via Supabase Dashboard (recommended for one-offs)

1. Open <https://supabase.com/dashboard/project/bxwmbrdndsetjwcexwpc/settings/functions>.
2. Scroll to "Edge Function Secrets".
3. Click **Add new secret** (or edit existing).
4. Set name + value, click **Save**.
5. Redeploy the affected function so it picks up the new secret.

### Via CLI

```bash
supabase secrets set NAME='value'
# multiple at once:
supabase secrets set FOO='bar' BAZ='qux'
```

For complex JSON values, prefer the Dashboard — quoting in shell is fragile
(see the `AGENT_FINANCE_PROFILE` setup in `REFINEMENT_LOG.md` PR #5c).

## Smoke testing after deploy

Each PR's `REFINEMENT_LOG.md` entry includes the curl commands and SQL
queries that verify the change. Run them. If smoke fails, roll back.

## Rolling back

### Frontend change (Vercel)

Vercel keeps every previous deploy. Open Vercel Dashboard → Deployments,
find the last known-good deploy, click **⋯ → Promote to Production**.
~10 seconds to switch over.

### Supabase migration

Migrations don't auto-rollback. To revert a migration:

1. Write a new migration (e.g. `046_rollback_045.sql`) that undoes the change.
2. Apply it the same way as a normal migration.

Or for fast emergencies, run the inverse SQL directly in the Dashboard SQL
Editor.

### Edge function

```bash
git checkout <previous-commit>~ -- supabase/functions/<name>/index.ts
supabase functions deploy <name>
git checkout HEAD -- supabase/functions/<name>/index.ts
```

Or just edit the function on the previous content and redeploy.

## Daily-briefing cron

Runs at 09:00 UTC (≈ 06:30 NDT / 05:30 NST). To trigger manually for testing:

```bash
ANON=$(grep "SUPABASE_ANON_KEY" config.js | grep -o "'eyJ[^']*'" | tr -d "'")
URL="https://bxwmbrdndsetjwcexwpc.supabase.co"
curl -s -X POST "$URL/functions/v1/daily-briefing" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

Returns 200 if the briefing generated and emailed successfully. Check
Supabase Dashboard → Edge Functions → Logs if it errors.

## Cleanup crons running in production

| Cron job | Schedule | What it does |
|---|---|---|
| `email-rate-limit-cleanup` | `10 3 * * *` UTC | Purge `email_rate_limit` rows older than 7 days |
| `claude-rate-limit-cleanup` | `15 3 * * *` UTC | Purge `claude_rate_limit` rows older than 7 days |
| `client-errors-cleanup` | `20 3 * * *` UTC | Purge `client_errors` rows older than 30 days |
| `daily-money-briefing` | `0 9 * * *` UTC | Generate + email Maxwell's daily money briefing |
| `daily-automation` | `0 8 * * *` UTC | Scan deals for deadline reminders, post-close referral emails, etc. |
| `weekly-backup` | `0 2 * * 0` UTC | Export full DB as JSON to Maxwell's Gmail |

To inspect cron health:

```sql
SELECT jobname, last_run_status, last_run_finished_at, next_run_at
FROM cron.job_run_details
ORDER BY last_run_finished_at DESC
LIMIT 20;
```

## CI workflow file changes

The PAT used for `git push` from terminal must have the `workflow` scope to
push changes to `.github/workflows/ci.yml`. If it doesn't, you'll see:

```
remote: refusing to allow a Personal Access Token to create or update
workflow `.github/workflows/ci.yml` without `workflow` scope.
```

Fixes:

1. Update PAT at <https://github.com/settings/tokens> — find your token,
   check the `workflow` scope, save.
2. OR edit the workflow file via GitHub web UI (uses session auth, bypasses
   PAT scope restriction).
