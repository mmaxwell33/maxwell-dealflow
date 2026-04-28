// Maxwell DealFlow CRM — send-email edge function (REFINED)
//
// What changed vs. the original:
//   1. Rate limiter now lives in Postgres (table email_rate_limit).
//      Cold starts no longer wipe the counter. Keyed by agent_id,
//      not by recipient domain (the old key was bogus — one noisy
//      client could silently consume the whole allowance).
//   2. GMAIL_USER no longer has a hardcoded fallback. If the secret
//      is missing we fail fast with a clear 500.
//   3. Requires a Supabase bearer token so we can attribute sends
//      to a real agent (needed for per-agent rate limiting).
//
// New Supabase secret needed:
//   SUPABASE_SERVICE_ROLE_KEY  (already present in most projects)
//
// Required migration:
//   /refined/security/migrations/017_email_rate_limit.sql

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AttachmentData {
  filename: string;
  mime_type: string;
  data: string;
}

// RFC 2047 encode a header value that contains non-ASCII characters
function mimeEncodeHeader(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  const b64 = base64Encode(bytes);
  return `=?UTF-8?B?${b64}?=`;
}

function toBase64Url(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRawMime(opts: {
  from: string; to: string; cc?: string | null; bcc?: string | null; subject: string;
  text: string; html?: string | null; ics?: string | null;
  attachments?: AttachmentData[] | null;
  inReplyTo?: string | null; references?: string | null;
}): Uint8Array {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const inner    = `i_${crypto.randomUUID().replace(/-/g, '')}`;
  const lines: string[] = [];

  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(`Subject: ${mimeEncodeHeader(opts.subject)}`);
  lines.push('MIME-Version: 1.0');
  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${opts.inReplyTo}`);
    lines.push(`References: ${opts.references || opts.inReplyTo}`);
  }

  const hasAttachments = (opts.attachments && opts.attachments.length > 0) || !!opts.ics;

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    if (opts.html) {
      lines.push(`Content-Type: multipart/alternative; boundary="${inner}"`);
      lines.push('');
      lines.push(`--${inner}`);
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: quoted-printable');
      lines.push('');
      lines.push(quotedPrintableEncode(opts.text));
      lines.push('');
      lines.push(`--${inner}`);
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: quoted-printable');
      lines.push('');
      lines.push(quotedPrintableEncode(opts.html));
      lines.push('');
      lines.push(`--${inner}--`);
    } else {
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: quoted-printable');
      lines.push('');
      lines.push(quotedPrintableEncode(opts.text));
    }
    lines.push('');
    if (opts.ics) {
      lines.push(`--${boundary}`);
      lines.push('Content-Type: text/calendar; charset=UTF-8; method=REQUEST');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('Content-Disposition: attachment; filename="viewing.ics"');
      lines.push('');
      const icsText = opts.ics;
      if (icsText.startsWith('BEGIN:VCALENDAR')) {
        lines.push(base64Encode(new TextEncoder().encode(icsText)));
      } else {
        lines.push(icsText);
      }
      lines.push('');
    }
    if (opts.attachments) {
      for (const att of opts.attachments) {
        lines.push(`--${boundary}`);
        lines.push(`Content-Type: ${att.mime_type}; name="${att.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
        lines.push('');
        lines.push(att.data);
        lines.push('');
      }
    }
    lines.push(`--${boundary}--`);
  } else if (opts.html) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: quoted-printable');
    lines.push('');
    lines.push(quotedPrintableEncode(opts.text));
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: quoted-printable');
    lines.push('');
    lines.push(quotedPrintableEncode(opts.html));
    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: quoted-printable');
    lines.push('');
    lines.push(quotedPrintableEncode(opts.text));
  }

  return new TextEncoder().encode(lines.join('\r\n'));
}

function quotedPrintableEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let result = '';
  let lineLen = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let encoded: string;
    if (b === 0x0D && i + 1 < bytes.length && bytes[i + 1] === 0x0A) {
      result += '\r\n'; lineLen = 0; i++; continue;
    } else if (b === 0x0A) {
      result += '\r\n'; lineLen = 0; continue;
    } else if ((b >= 33 && b <= 126 && b !== 61) || b === 9 || b === 32) {
      encoded = String.fromCharCode(b);
    } else {
      encoded = '=' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    if (lineLen + encoded.length > 75) {
      result += '=\r\n'; lineLen = 0;
    }
    result += encoded;
    lineLen += encoded.length;
  }
  return result;
}

// ── DB-BACKED RATE LIMITER ──────────────────────────────────────────────────
// 60 emails per hour per agent, stored in Postgres. Survives cold starts.
const RATE_LIMIT_MAX = 60;

async function checkRateLimit(
  adminDb: ReturnType<typeof createClient>,
  agentId: string,
): Promise<{ allowed: boolean; remaining: number; count: number }> {
  // Truncate to the top of the hour — everyone in the same hour shares a row.
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const { data, error } = await adminDb.rpc('increment_email_rate_limit', {
    p_agent_id: agentId,
    p_window_start: windowStart.toISOString(),
  });

  if (error) {
    // Fail open with a warning — better to send the email than to silently drop it.
    console.warn('Rate-limit RPC failed, allowing send:', error.message);
    return { allowed: true, remaining: RATE_LIMIT_MAX, count: 0 };
  }

  const count = typeof data === 'number' ? data : 0;
  return { allowed: count <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - count), count };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth: identify the calling agent ────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing bearer token' }, 401);
    }
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient   = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const adminDb = createClient(supabaseUrl, serviceKey);

    // ── Rate limit per agent ────────────────────────────────────────────────
    const { allowed, count } = await checkRateLimit(adminDb, user.id);
    if (!allowed) {
      return json({
        error: `Rate limit exceeded (${count}/${RATE_LIMIT_MAX} emails this hour). Try again after the top of the next hour.`,
      }, 429);
    }

    // ── Parse request ───────────────────────────────────────────────────────
    const { to, cc, bcc, subject, body, html, ics, attachments, from_name, thread_id, in_reply_to, references } = await req.json();

    if (!to || !subject || !body) {
      return json({ error: 'Missing: to, subject, body' }, 400);
    }

    // ── Config (all from secrets — no hardcoded fallbacks) ─────────────────
    const GMAIL_USER    = Deno.env.get('GMAIL_USER');
    const CLIENT_ID     = Deno.env.get('GMAIL_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET');
    const REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN');
    const fromName      = from_name || Deno.env.get('AGENT_NAME') || 'Your Agent';

    if (!GMAIL_USER) {
      return json({ error: 'GMAIL_USER not configured in Supabase secrets' }, 500);
    }
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      return json({
        error: 'Gmail OAuth not configured. Need GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Supabase secrets.',
      }, 500);
    }

    // Step 1: Access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error('OAuth token failed: ' + JSON.stringify(tokenData));
    }

    // Step 2: MIME
    const rawBytes = buildRawMime({
      from: `${fromName} <${GMAIL_USER}>`,
      to,
      cc: cc || null,
      bcc: bcc || null,
      subject,
      text: body,
      html: html || null,
      ics: ics || null,
      attachments: attachments || null,
      inReplyTo: in_reply_to || null,
      references: references || null,
    });

    // Step 3: Encode
    const encoded = toBase64Url(rawBytes);

    // Step 4: Send
    const sendPayload: Record<string, string> = { raw: encoded };
    if (thread_id) sendPayload.threadId = thread_id;

    const sendRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendPayload),
      },
    );
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      throw new Error('Gmail send failed: ' + (sendData.error?.message || JSON.stringify(sendData)));
    }

    return json({
      success: true,
      gmail_message_id: sendData.id || null,
      gmail_thread_id: sendData.threadId || null,
    }, 200);
  } catch (err) {
    console.error('Send error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
