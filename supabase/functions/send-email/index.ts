import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Send email via Gmail API using OAuth2 refresh token.
 * Emails come directly FROM maxwelldelali22@gmail.com — no "on behalf of".
 *
 * Required Supabase secrets:
 *   GMAIL_USER            – your Gmail address
 *   GMAIL_CLIENT_ID       – from Google Cloud Console
 *   GMAIL_CLIENT_SECRET   – from Google Cloud Console
 *   GMAIL_REFRESH_TOKEN   – from OAuth Playground
 */

interface AttachmentData {
  filename: string;
  mime_type: string;
  data: string; // base64-encoded file content
}

// RFC 2047 encode a header value that contains non-ASCII characters
function mimeEncodeHeader(value: string): string {
  // If it's pure ASCII printable, no encoding needed
  if (!/[^\x20-\x7E]/.test(value)) return value;
  // Encode as UTF-8 bytes then base64
  const bytes = new TextEncoder().encode(value);
  const b64 = base64Encode(bytes);
  return `=?UTF-8?B?${b64}?=`;
}

// Convert a Uint8Array to a base64url string (URL-safe, no padding)
function toBase64Url(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRawMime(opts: {
  from: string; to: string; cc?: string | null; subject: string;
  text: string; html?: string | null; ics?: string | null;
  attachments?: AttachmentData[] | null;
  inReplyTo?: string | null; references?: string | null;
}): Uint8Array {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const inner    = `i_${crypto.randomUUID().replace(/-/g, '')}`;
  const lines: string[] = [];

  // ── RFC 5322 headers ──────────────────────────────────────────────────────
  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
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
      // ics may already be base64 or raw text
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

// Quoted-Printable encode: keeps ASCII printable as-is, encodes everything else
// This is the correct way to encode email body content with UTF-8 chars
function quotedPrintableEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let result = '';
  let lineLen = 0;

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let encoded: string;

    if (b === 0x0D && i + 1 < bytes.length && bytes[i + 1] === 0x0A) {
      // CRLF — keep as-is, reset line length
      result += '\r\n';
      lineLen = 0;
      i++;
      continue;
    } else if (b === 0x0A) {
      result += '\r\n';
      lineLen = 0;
      continue;
    } else if ((b >= 33 && b <= 126 && b !== 61) || b === 9 || b === 32) {
      encoded = String.fromCharCode(b);
    } else {
      encoded = '=' + b.toString(16).toUpperCase().padStart(2, '0');
    }

    // Soft line break at 76 chars
    if (lineLen + encoded.length > 75) {
      result += '=\r\n';
      lineLen = 0;
    }
    result += encoded;
    lineLen += encoded.length;
  }
  return result;
}

// ── IN-MEMORY RATE LIMITER ────────────────────────────────────────────────────
// Limits to 60 emails per hour per agent to prevent abuse / Gmail suspension
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX   = 60;   // max emails per window
const RATE_LIMIT_WINDOW = 3600000; // 1 hour in ms

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, cc, subject, body, html, ics, attachments, from_name, thread_id, in_reply_to, references } = await req.json();

    // ── RATE LIMIT CHECK ────────────────────────────────────────────────────
    const rateLimitKey = to?.split('@')[1] || 'default'; // key by sender domain
    const { allowed, remaining } = checkRateLimit(rateLimitKey);
    if (!allowed) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded. Maximum 60 emails per hour. Please try again later.'
      }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // ───────────────────────────────────────────────────────────────────────

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing: to, subject, body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GMAIL_USER    = Deno.env.get('GMAIL_USER') || 'maxwelldelali22@gmail.com';
    const CLIENT_ID     = Deno.env.get('GMAIL_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET');
    const REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN');
    const fromName      = from_name || 'Maxwell Delali Midodzi';

    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      return new Response(JSON.stringify({
        error: 'Gmail OAuth not configured. Need GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Supabase secrets.',
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 1: Get access token
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

    // Step 2: Build MIME message as bytes
    const rawBytes = buildRawMime({
      from: `${fromName} <${GMAIL_USER}>`,
      to,
      cc: cc || null,
      subject,
      text: body,
      html: html || null,
      ics: ics || null,
      attachments: attachments || null,
      inReplyTo: in_reply_to || null,
      references: references || null,
    });

    // Step 3: Base64url encode the raw bytes directly
    const encoded = toBase64Url(rawBytes);

    // Step 4: Send via Gmail API
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
      }
    );
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      throw new Error('Gmail send failed: ' + (sendData.error?.message || JSON.stringify(sendData)));
    }

    return new Response(JSON.stringify({
      success: true,
      gmail_message_id: sendData.id || null,
      gmail_thread_id: sendData.threadId || null,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Send error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
