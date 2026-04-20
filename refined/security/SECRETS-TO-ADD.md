# Supabase Secrets to Add — Phase 2.A

Add these via **Supabase Dashboard → Project Settings → Edge Functions → Secrets**,
or with the CLI:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set AGENT_EMAIL=maxwelldelali22@gmail.com
supabase secrets set AGENT_NAME="Maxwell Delali Midodzi"
```

---

## New secrets

| Secret | Value | Required by | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (Maxwell's personal Claude key, or a project key from console.anthropic.com) | `claude-chat` edge function | Rotate anytime — browser never sees it again. |
| `AGENT_EMAIL` | `maxwelldelali22@gmail.com` | `backup-data`, `morning-briefing` | Where the weekly backup and morning briefing land. Can differ from the sending mailbox. |
| `AGENT_NAME` | `Maxwell Delali Midodzi` | `send-email`, `morning-briefing` | Human-readable From-name. Falls back to `Maxwell DealFlow` / `Your Agent` if unset. |

## Existing secrets (should already exist — verify)

| Secret | Used by |
|---|---|
| `SUPABASE_URL` | all |
| `SUPABASE_ANON_KEY` | `claude-chat`, `send-email` (auth guard) |
| `SUPABASE_SERVICE_ROLE_KEY` | `send-email` (rate-limit RPC), `backup-data` (read-all), `morning-briefing` |
| `GMAIL_USER` | `send-email`, `backup-data`, `morning-briefing` — **remove any hardcoded fallback in code** |
| `GMAIL_CLIENT_ID` | all Gmail functions |
| `GMAIL_CLIENT_SECRET` | all Gmail functions |
| `GMAIL_REFRESH_TOKEN` | all Gmail functions |
| `VAPID_PRIVATE_KEY` | `send-push` |
| `VAPID_PUBLIC_KEY` | `send-push` |
| `VAPID_SUBJECT` | `send-push` |

---

## Removal checklist

After the new `claude-chat` function is live and `js/ai.js` is replaced:

* Revoke the old Claude API key Maxwell pasted into the app (it's been
  sitting in his browser's localStorage for months).
* Clear `df_claude_key` from his browser storage. A one-liner in the
  Settings screen would do it, or he can clear site data in iOS Safari.

## Test checklist (post-deploy)

* [ ] Open Settings → Ask AI tab. Ask "How many clients need follow-up?".
      Response should come back without any key prompt.
* [ ] Call `send-email` directly with a test payload. Confirm the 429
      rate-limit path by flooding it (use a throwaway agent).
* [ ] Trigger `backup-data` manually. Check the inbox for the JSON
      attachment.
* [ ] Trigger `morning-briefing` manually. Check the From: header.
* [ ] Run `select count(*) from email_rate_limit;` in SQL editor after a
      few sends. Rows should exist.
