# Phase 2.A — Security Hardening Diff Summary

Three fixes. All new code lives in `/refined/security/`. Originals are
untouched. Apply when you're ready.

| # | Fix | Risk today | New files |
|---|---|---|---|
| 1 | Claude API key out of the browser | HIGH — key leaks, usage caps | `edge-functions/claude-chat/`, `js/ai.js` |
| 2 | DB-backed email rate limiter | MEDIUM — cold starts wipe the counter | `migrations/017_email_rate_limit.sql`, `edge-functions/send-email/` |
| 3 | AGENT_EMAIL env var (no hardcoded gmail) | LOW — annoyance when re-used | `edge-functions/backup-data/`, `edge-functions/morning-briefing/PATCH.md` |

---

## Fix #1 — Claude API key on the server

### Problem

`js/ai.js` line 258:

```js
localStorage.setItem('df_claude_key', AI.apiKey);
```

…and line 41 calls `https://api.anthropic.com/v1/messages` directly from
the browser with `anthropic-dangerous-direct-browser-access: 'true'`.
Anyone with devtools can grab the key. Key rotation = every agent must
re-paste. A leaked key hits the whole Anthropic billing account.

### Fix

New edge function `claude-chat` holds the key in Supabase secrets and
proxies the request. Frontend calls `db.functions.invoke('claude-chat', …)`
with the signed-in Supabase session as auth.

### BEFORE — `js/ai.js` lines 39-79

```js
async callClaude(userMsg, context) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': AI.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1500, system: `...`, messages: [...] })
  });
  if (!res.ok) { /* throw */ }
  const data = await res.json();
  return data.content?.[0]?.text || 'No response received.';
},
```

### AFTER — `js/ai.js` lines 58-86 (refined copy)

```js
async callClaude(userMsg, context) {
  const system = `You are the AI assistant built into Maxwell DealFlow CRM...`;
  const messages = [
    ...AI.history.slice(-14),
    { role: 'user', content: userMsg }
  ];

  const { data, error } = await db.functions.invoke('claude-chat', {
    body: { system, messages, model: 'claude-haiku-4-5', max_tokens: 1500 }
  });

  if (error) throw new Error(error.message || 'AI request failed');
  if (data?.error) throw new Error(data.error);
  return data?.text || 'No response received.';
},
```

### Also removed from `js/ai.js`

* `apiKey: ''` field
* `setApiKey()` + `loadSavedKey()` functions (no more localStorage)
* `AI.loadSavedKey()` call inside the DOMContentLoaded handler

### UI work still owed (not in this batch)

* Replace the "Paste your Claude API key" field in Settings → Security
  with a read-only "🟢 AI is connected" / "🔴 AI offline" indicator.
* Drop `ai-key-status` references from `index.ts` if they're wired to the
  old key input.

### New file

`/refined/security/edge-functions/claude-chat/index.ts` — verifies the
bearer token, reads `ANTHROPIC_API_KEY` from `Deno.env`, forwards to
`api.anthropic.com`, returns `{ text }`.

---

## Fix #2 — Email rate limiter in Postgres

### Problem

`supabase/functions/send-email/index.ts` lines 186-204:

```ts
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
```

An in-memory `Map` inside a Deno worker. Every cold start (Supabase
recycles workers aggressively) resets the counter. Real enforcement ≈ 0.
Also keyed by recipient domain (`to.split('@')[1]`), which means one
client domain with many contacts silently eats the whole allowance for
everyone.

### Fix

1. New Postgres table `email_rate_limit` (agent_id, window_start hour
   bucket, count).
2. Stored procedure `increment_email_rate_limit(agent_id, window_start)`
   does the atomic upsert-and-return.
3. Edge function reads the authenticated user, calls the RPC, blocks on
   count > 60.
4. pg_cron job purges rows older than 7 days every night at 03:10 UTC.

### BEFORE — `send-email/index.ts` lines 213-223

```ts
const { to, cc, bcc, subject, body, ... } = await req.json();

// ── RATE LIMIT CHECK ────────────────────────────────────────────────────
const rateLimitKey = to?.split('@')[1] || 'default';  // ← wrong key
const { allowed, remaining } = checkRateLimit(rateLimitKey);
if (!allowed) {
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded. Maximum 60 emails per hour. Please try again later.'
  }), { status: 429, ... });
}
```

### AFTER — `send-email/index.ts` (refined copy)

```ts
// Auth first — identify the agent
const authHeader = req.headers.get('Authorization') || '';
if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing bearer token' }, 401);
const { data: { user } } = await userClient.auth.getUser();
if (!user) return json({ error: 'Not signed in' }, 401);

// DB-backed rate limit keyed by agent_id
const { allowed, count } = await checkRateLimit(adminDb, user.id);
if (!allowed) {
  return json({
    error: `Rate limit exceeded (${count}/${RATE_LIMIT_MAX} emails this hour). Try again after the top of the next hour.`,
  }, 429);
}

// Parse body…
const { to, cc, bcc, subject, body, ... } = await req.json();
```

### New files

* `/refined/security/migrations/017_email_rate_limit.sql`
* `/refined/security/edge-functions/send-email/index.ts`

---

## Fix #3 — Configurable agent email

### Problem

Three files hardcode `maxwelldelali22@gmail.com`:

| File | Line |
|---|---|
| `supabase/functions/send-email/index.ts` | 231 (fallback) |
| `supabase/functions/backup-data/index.ts` | 36 (fallback) |
| `supabase/functions/morning-briefing/index.ts` | 60 (From header) + 452 (To) |

If `GMAIL_USER` ever gets mis-set, the backup and morning briefing still
go to Maxwell's Gmail silently. Plus this CRM might get re-used by
another agent — there should be zero hardcoded addresses.

### Fix

All three functions read from secrets. No fallbacks to literal email
addresses. New pattern:

* `GMAIL_USER`   — mailbox that *sends* (OAuth'd Gmail account)
* `AGENT_EMAIL`  — mailbox that *receives* backups / briefings
* `AGENT_NAME`   — From display name

### BEFORE — `send-email/index.ts` line 231

```ts
const GMAIL_USER = Deno.env.get('GMAIL_USER') || 'maxwelldelali22@gmail.com';
```

### AFTER

```ts
const GMAIL_USER = Deno.env.get('GMAIL_USER');
if (!GMAIL_USER) return json({ error: 'GMAIL_USER not configured in Supabase secrets' }, 500);
```

### BEFORE — `backup-data/index.ts` line 36

```ts
const GMAIL_USER = Deno.env.get('GMAIL_USER') || 'maxwelldelali22@gmail.com';
```

### AFTER

```ts
const GMAIL_USER  = Deno.env.get('GMAIL_USER');
const AGENT_EMAIL = Deno.env.get('AGENT_EMAIL') || GMAIL_USER;
if (!GMAIL_USER)  throw new Error('GMAIL_USER not set');
if (!AGENT_EMAIL) throw new Error('AGENT_EMAIL not set');
// …backup email now goes `To: ${AGENT_EMAIL}` instead of `To: ${GMAIL_USER}`
```

### BEFORE — `morning-briefing/index.ts` line 60

```ts
`From: Maxwell DealFlow <maxwelldelali22@gmail.com>`,
```

### AFTER

```ts
const fromName = Deno.env.get('AGENT_NAME') || 'Maxwell DealFlow';
const fromAddr = Deno.env.get('GMAIL_USER');
if (!fromAddr) throw new Error('GMAIL_USER not configured');
// then:
`From: ${fromName} <${fromAddr}>`,
```

### BEFORE — `morning-briefing/index.ts` line 452

```ts
const mimeBytes = buildMimeEmail('maxwelldelali22@gmail.com', subject, plainBody, htmlBody);
```

### AFTER

```ts
const briefingTo = Deno.env.get('AGENT_EMAIL') || Deno.env.get('GMAIL_USER');
if (!briefingTo) return json({ error: 'AGENT_EMAIL / GMAIL_USER not configured' }, 500);
const mimeBytes = buildMimeEmail(briefingTo, subject, plainBody, htmlBody);
```

### New files

* `/refined/security/edge-functions/send-email/index.ts` (full refined copy)
* `/refined/security/edge-functions/backup-data/index.ts` (full refined copy)
* `/refined/security/edge-functions/morning-briefing/PATCH.md` (two surgical edits)

---

## Rollout order

1. Add the new Supabase secrets (see `SECRETS-TO-ADD.md`).
2. Run migration `017_email_rate_limit.sql` via Supabase dashboard.
3. Deploy the `claude-chat` edge function (`supabase functions deploy claude-chat`).
4. Replace `js/ai.js` with the refined version.
5. Deploy the refined `send-email` function.
6. Deploy the refined `backup-data` function.
7. Apply the two-line patch to `morning-briefing` and redeploy.
8. Smoke test: ask the AI a question, send one test email, trigger the
   backup function manually, trigger the morning briefing manually.
9. Once green: remove the old Claude API key input from the Settings UI
   (Phase 2.B UI pass).

## What Phase 2.A deliberately does NOT touch

* UI polish (that's Phase 2.B)
* Splitting `app.js` or `notifications.js` (Phase 2.C refactor)
* Adding tests (Phase 2.D test harness)
* Existing RLS policies (already solid per the audit)
