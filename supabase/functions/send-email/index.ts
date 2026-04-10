import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Send email via Gmail API using OAuth2 refresh token.
 * No SMTP, no third-party email service, no domain needed.
 * Emails come directly FROM maxwelldelali22@gmail.com — no "on behalf of".
 *
 * Supports reply threading:
 *   thread_id   – Gmail threadId to keep reply in same thread
 *   in_reply_to – Message-ID header of the message being replied to
 *   references  – References header chain for threading
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

// Encode a header value that may contain non-ASCII chars (RFC 2047 Base64)
function encodeHeader(value: string): string {
  // Check if any character is outside printable ASCII range
  if (/[^\x20-\x7E]/.test(value)) {
    const b64 = btoa(unescape(encodeURIComponent(value)));
    return `=?UTF-8?B?${b64}?=`;
  }
  return value;
}

function buildRawMime(opts: {
  from: string; to: string; cc?: string | null; subject: string;
  text: string; html?: string | null; ics?: string | null;
  attachments?: AttachmentData[] | null;
  inReplyTo?: string | null; references?: string | null;
}): string {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const inner = `i_${crypto.randomUUID().replace(/-/g, '')}`;
  const lines: string[] = [];

  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  // Encode subject using RFC 2047 so special chars (em-dash, accents, etc.) survive
  lines.push(`Subject: ${encodeHeader(opts.subject)}`);
  lines.push('MIME-Version: 1.0');

  // Reply threading headers
  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${opts.inReplyTo}`);
    lines.push(`References: ${opts.references || opts.inReplyTo}`);
  }

  const hasAttachments = (opts.attachments && opts.attachments.length > 0) || opts.ics;

  if (hasAttachments) {
    // multipart/mixed wraps everything when there are attachments
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    // Body part (text or html+text)
    lines.push(`--${boundary}`);
    if (opts.html) {
      lines.push(`Content-Type: multipart/alternative; boundary="${inner}"`);
      lines.push('');
      lines.push(`--${inner}`);
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('');
      lines.push(opts.text);
      lines.push('');
      lines.push(`--${inner}`);
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('');
      lines.push(opts.html);
      lines.push('');
      lines.push(`--${inner}--`);
    } else {
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('');
      lines.push(opts.text);
    }
    lines.push('');
    // ICS calendar attachment
    if (opts.ics) {
      lines.push(`--${boundary}`);
      lines.push('Content-Type: text/calendar; charset=UTF-8; method=REQUEST');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('Content-Disposition: attachment; filename="viewing.ics"');
      lines.push('');
      const icsText = opts.ics;
      if (icsText.startsWith('BEGIN:VCALENDAR')) {
        lines.push(btoa(unescape(encodeURIComponent(icsText))));
      } else {
        lines.push(icsText);
      }
      lines.push('');
    }
    // Generic file attachments
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
    lines.push('');
    lines.push(opts.text);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('');
    lines.push(opts.html);
    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('');
    lines.push(opts.text);
  }

  return lines.join('\r\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, cc, subject, body, html, ics, attachments, from_name, thread_id, in_reply_to, references } = await req.json();

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing: to, subject, body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GMAIL_USER = Deno.env.get('GMAIL_USER') || 'maxwelldelali22@gmail.com';
    const CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET');
    const REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN');
    const fromName = from_name || 'Maxwell Delali Midodzi';

    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      return new Response(JSON.stringify({
        error: 'Gmail OAuth not configured. Need GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Supabase secrets.',
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Get access token from refresh token
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

    // Step 2: Build MIME message (with optional reply headers)
    const raw = buildRawMime({
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

    // Step 3: Base64url encode using TextEncoder (handles Unicode correctly)
    const rawBytes = new TextEncoder().encode(raw);
    let binary = '';
    rawBytes.forEach(b => binary += String.fromCharCode(b));
    const encoded = btoa(binary)
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Step 4: Send via Gmail API (include threadId for replies)
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

    // Return Gmail metadata (messageId + threadId) for inbox logging
    return new Response(JSON.stringify({
      success: true,
      gmail_message_id: sendData.id || null,
      gmail_thread_id: sendData.threadId || null,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Send error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
