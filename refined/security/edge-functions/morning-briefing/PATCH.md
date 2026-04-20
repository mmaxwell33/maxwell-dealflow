# morning-briefing — AGENT_EMAIL patch

Only two lines change. Rather than fork the whole 477-line function,
apply these two surgical edits directly to
`supabase/functions/morning-briefing/index.ts`.

## Pre-requisite

Add two Supabase secrets (both optional but recommended):

```
AGENT_EMAIL   = maxwelldelali22@gmail.com
AGENT_NAME    = Maxwell DealFlow
```

Existing `GMAIL_USER` stays as-is — it's the mailbox that *sends* the mail.

---

## Edit 1 — `buildMimeEmail()` From header (around line 60)

**BEFORE**

```ts
const mime = [
  `From: Maxwell DealFlow <maxwelldelali22@gmail.com>`,
  `To: ${to}`,
  `Subject: ${mimeEncodeHeader(subject)}`,
```

**AFTER**

```ts
const fromName = Deno.env.get('AGENT_NAME') || 'Maxwell DealFlow';
const fromAddr = Deno.env.get('GMAIL_USER');
if (!fromAddr) throw new Error('GMAIL_USER not configured');

const mime = [
  `From: ${fromName} <${fromAddr}>`,
  `To: ${to}`,
  `Subject: ${mimeEncodeHeader(subject)}`,
```

---

## Edit 2 — recipient on line 452

**BEFORE**

```ts
const mimeBytes = buildMimeEmail('maxwelldelali22@gmail.com', subject, plainBody, htmlBody);
```

**AFTER**

```ts
const briefingTo = Deno.env.get('AGENT_EMAIL') || Deno.env.get('GMAIL_USER');
if (!briefingTo) {
  return new Response(JSON.stringify({ error: 'AGENT_EMAIL / GMAIL_USER not configured' }), {
    status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
const mimeBytes = buildMimeEmail(briefingTo, subject, plainBody, htmlBody);
```

---

## Why this matters

* No hardcoded `maxwelldelali22@gmail.com` anywhere in the repo. One place
  to change when the CRM ships to a second agent.
* Matches the pattern used in `send-email` and `backup-data` — consistent
  across the 3 edge functions that send mail.
* Fails loudly if the config is missing instead of silently emailing
  the wrong mailbox.
