# SECRETS.md

Inventory of every secret in the Maxwell DealFlow system: where it lives,
what it does, and how to rotate it. **No actual values in this file.**

## Public values (shipped in source — these are NOT secrets)

| Name | Where | What |
|---|---|---|
| `SUPABASE_URL` | `config.js` (root) | `https://bxwmbrdndsetjwcexwpc.supabase.co` — project URL. Identifies the Supabase project; combining it with the anon key gives RLS-scoped public access. Safe to commit. |
| `SUPABASE_ANON_KEY` | `config.js` + duplicated in `respond.html`, `intake.html`, `seller-intake.html`, `build.html` | JWT with `role: anon` and `exp: 2090574398` (≈ 2036). RLS gates what anon can do; the key itself is meant to be public. Listed here because we **do** want to track when this gets rotated. |
| `VAPID_PUBLIC_KEY` | `config.js` | Web Push public key (87-char base64url P-256). Browsers need this to subscribe to push. Pairs with the private key kept in Supabase secrets (see below). |

## Supabase Edge Function secrets (set via Dashboard → Project Settings → Edge Functions → Secrets)

| Secret name | Used by | What | Rotation impact |
|---|---|---|---|
| `SUPABASE_URL` | auto-injected | The project URL. Don't set manually. | — |
| `SUPABASE_ANON_KEY` | auto-injected | The anon JWT. Don't set manually. | — |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | The service-role JWT (bypasses RLS). Don't set manually. | — |
| `GMAIL_USER` | `send-email` | The Gmail address messages are sent **from**. Currently `maxwelldelali22@gmail.com`. | Change requires updating Gmail OAuth consent screen if address changes. |
| `GMAIL_CLIENT_ID` | `send-email` | Google OAuth Client ID for the Gmail send-mail flow. | Rotate via Google Cloud Console → APIs & Services → Credentials. Update Supabase secret with the new value. |
| `GMAIL_CLIENT_SECRET` | `send-email` | Paired secret for `GMAIL_CLIENT_ID`. | Same as above — rotate in Google Cloud Console. |
| `GMAIL_REFRESH_TOKEN` | `send-email` | Long-lived OAuth refresh token. **High blast radius if leaked** — anyone with this can send email as Maxwell indefinitely. | Revoke at <https://myaccount.google.com/permissions> → "Maxwell DealFlow" → Remove. Then re-do the OAuth flow and update the Supabase secret. |
| `VAPID_PUBLIC_KEY` | `send-push` | Public half of the VAPID keypair. Must match `config.js`. | Generate new pair with `npx web-push generate-vapid-keys`. Update BOTH `config.js` and this secret. Old push subscriptions become invalid — users need to re-subscribe on next sign-in. |
| `VAPID_PRIVATE_KEY` | `send-push` | Private half of the VAPID keypair. Used to sign push JWTs. | Same rotation flow as `VAPID_PUBLIC_KEY` — always rotate the pair together. |
| `VAPID_SUBJECT` | `send-push` | `mailto:Maxwell.Midodzi@exprealty.com` — push provider contact for abuse reports. | Change only if Maxwell's contact email changes. |
| `ANTHROPIC_API_KEY` | `claude-chat` | Claude API key for the Ask AI feature. Starts with `sk-ant-`. **High blast radius if leaked** — bills go to Anthropic. | Rotate at <https://console.anthropic.com> → API Keys → Generate new → Update Supabase secret → Disable old key. |
| `OPENAI_API_KEY` | `daily-briefing` | OpenAI key for the briefing-generation pipeline (gpt-4o-mini for content, tts-1 for podcast voice). | Rotate at <https://platform.openai.com/api-keys> → Generate new → Update Supabase secret → Disable old key. |
| `AGENT_FINANCE_PROFILE` | `daily-briefing` | JSON blob with Maxwell's monthly income, fixed costs, future commission dates, account contribution status, watchlists. **PII**. | Update via Dashboard with new JSON. The function reads it on each cold start. |

## Vercel environment variables

The site is a static deploy; no server-side env vars are read. Skip.

## GitHub

| Secret | Used by | Rotation |
|---|---|---|
| Personal Access Token (PAT) on Maxwell's Mac keychain | `git push` from terminal | Update at <https://github.com/settings/tokens>. The current PAT lacks `workflow` scope — workflow file changes must go through the GitHub web UI. Recommend creating a new PAT with `repo` + `workflow` scopes and replacing the keychain entry. |
| Two-factor auth (TOTP) | Sign-in to github.com | If the TOTP secret is lost: <https://github.com/recover-account>. |

## Rotation checklist (annually, or after any suspected leak)

1. **Anthropic API key** — generate new in console, update Supabase, disable old.
2. **OpenAI API key** — same pattern.
3. **Gmail OAuth refresh token** — revoke + redo OAuth + update Supabase.
4. **VAPID keypair** — generate new, update `config.js` + Supabase, accept that
   existing push subscriptions will need to re-subscribe.
5. **Supabase anon key** — generate new in Supabase Dashboard → Project
   Settings → API → Rotate. Update `config.js` + the four public HTML files
   that duplicate it.
6. **Supabase service-role key** — only rotate if you suspect a leak (every
   internal cron/edge function relies on this — rotating means redeploying
   all functions that reference it).

## What's NOT secret (and intentionally so)

- Maxwell's email signature blocks and brokerage info — committed in
  `notifications.js` email templates.
- The respond/portal/intake page link tokens — they're cryptographically
  random per viewing (UUIDv4) and gated by RLS server-side.
- Cron schedules — visible in migration files.

## Audit notes

- The audit (§1.6.5) flagged that the Gmail refresh token has no rotation
  runbook. This file is that runbook. Recommend re-running it every 12
  months even if no leak is suspected.
- The audit (§1.6.3, §1.6.4) flagged hardcoded financial data + recipient
  address in `daily-briefing/index.ts`. PR #5c fixed those by moving the
  whole `PROFILE` object into the `AGENT_FINANCE_PROFILE` secret.
