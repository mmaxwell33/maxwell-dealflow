import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Email sending via Gmail API (OAuth2 service account) ─────────────────────
// Secrets required in Supabase Dashboard → Edge Functions → Secrets:
//   GMAIL_USER         = maxwelldelali22@gmail.com
//   GMAIL_CLIENT_ID    = from Google Cloud Console OAuth2 credentials
//   GMAIL_CLIENT_SECRET= from Google Cloud Console OAuth2 credentials
//   GMAIL_REFRESH_TOKEN= obtained via OAuth2 consent flow
//
// Until OAuth2 is set up, this falls back to sending to GMAIL_USER (agent)
// with the client email clearly shown so agent can forward.

async function getGmailAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

async function sendViaGmailAPI(accessToken: string, raw: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error?.message || JSON.stringify(data) };
  return { ok: true };
}

function buildRaw(opts: {
  from: string; to: string; bcc: string; replyTo: string;
  subject: string; text: string; html?: string | null; ics?: string | null;
}): string {
  const b = `b${Date.now()}`;
  const ib = `ib${Date.now()}`;
  const lines: string[] = [];
  lines.push(`From: ${opts.from}`, `To: ${opts.to}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(`Reply-To: ${opts.replyTo}`, `Subject: ${opts.subject}`, 'MIME-Version: 1.0');

  if (opts.ics) {
    lines.push(`Content-Type: multipart/mixed; boundary="${b}"`, '');
    lines.push(`--${b}`, `Content-Type: multipart/alternative; boundary="${ib}"`, '');
    lines.push(`--${ib}`, 'Content-Type: text/plain; charset=UTF-8', '', opts.text, '');
    if (opts.html) lines.push(`--${ib}`, 'Content-Type: text/html; charset=UTF-8', '', opts.html, '');
    lines.push(`--${ib}--`, '');
    lines.push(`--${b}`, 'Content-Type: text/calendar; charset=UTF-8; method=REQUEST',
      'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="viewing.ics"', '', opts.ics, '');
    lines.push(`--${b}--`);
  } else if (opts.html) {
    lines.push(`Content-Type: multipart/alternative; boundary="${b}"`, '');
    lines.push(`--${b}`, 'Content-Type: text/plain; charset=UTF-8', '', opts.text, '');
    lines.push(`--${b}`, 'Content-Type: text/html; charset=UTF-8', '', opts.html, '');
    lines.push(`--${b}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8', '', opts.text);
  }
  return lines.join('\r\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, subject, body, html, ics, from_name } = await req.json();
    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing: to, subject, body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const GMAIL_USER          = Deno.env.get('GMAIL_USER')          || 'maxwelldelali22@gmail.com';
    const GMAIL_CLIENT_ID     = Deno.env.get('GMAIL_CLIENT_ID');
    const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET');
    const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN');
    const RESEND_API_KEY      = Deno.env.get('RESEND_API_KEY');
    const fromName = from_name || 'Maxwell Delali Midodzi';

    // ── PATH 1: Gmail API (OAuth2) — sends directly to any email ────────────
    if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN) {
      const accessToken = await getGmailAccessToken(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN);
      if (accessToken) {
        const raw = buildRaw({
          from: `${fromName} <${GMAIL_USER}>`, to, bcc: GMAIL_USER,
          replyTo: GMAIL_USER, subject, text: body, html: html || null, ics: ics || null,
        });
        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const result = await sendViaGmailAPI(accessToken, encoded);
        if (result.ok) {
          return new Response(JSON.stringify({ success: true, method: 'gmail_api' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // fall through to Resend if Gmail API fails
      }
    }

    // ── PATH 2: Resend (requires verified domain for non-owner emails) ────────
    if (RESEND_API_KEY) {
      // If we don't have Gmail OAuth, send to agent's Gmail with client email shown prominently
      // Agent receives the full beautiful email and can forward it to the client.
      const isOwnerEmail = to === GMAIL_USER;
      const actualTo = isOwnerEmail ? to : GMAIL_USER; // Resend test mode restriction
      const subjectLine = isOwnerEmail ? subject : `📨 Send to ${to} — ${subject}`;

      const warningBanner = !isOwnerEmail
        ? `<div style="background:#fff3cd;border-left:4px solid #f0a500;padding:12px 16px;margin-bottom:20px;font-family:Arial,sans-serif;font-size:13px;border-radius:0 6px 6px 0;"><strong>⚡ Action needed:</strong> Forward this email to your client: <a href="mailto:${to}" style="color:#1a6ef5;font-weight:700;">${to}</a><br><span style="color:#888;font-size:12px;">To send automatically, verify a free domain at <a href="https://resend.com/domains">resend.com/domains</a></span></div>`
        : '';

      const payload: Record<string, unknown> = {
        from: `${fromName} <onboarding@resend.dev>`,
        to: [actualTo],
        reply_to: to,
        subject: subjectLine,
        text: !isOwnerEmail ? `FORWARD TO: ${to}\n\n${body}` : body,
        html: html ? (warningBanner + html) : undefined,
      };
      if (ics) {
        payload.attachments = [{ filename: 'viewing.ics', content: ics, content_type: 'text/calendar; charset=utf-8; method=REQUEST' }];
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: result.message || 'Resend error' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        success: true, method: 'resend',
        note: isOwnerEmail ? 'Sent to agent' : `Delivered to your Gmail — forward to ${to} or verify a domain for direct delivery`,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'No email provider configured. Set GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN or RESEND_API_KEY in Supabase secrets.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
