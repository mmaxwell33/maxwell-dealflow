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
 * Required Supabase secrets:
 *   GMAIL_USER            – your Gmail address
 *   GMAIL_CLIENT_ID       – from Google Cloud Console
 *   GMAIL_CLIENT_SECRET   – from Google Cloud Console
 *   GMAIL_REFRESH_TOKEN   – from OAuth Playground
 */

function buildRawMime(opts: {
  from: string; to: string; subject: string;
  text: string; html?: string | null; ics?: string | null;
}): string {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const inner = `i_${crypto.randomUUID().replace(/-/g, '')}`;
  const lines: string[] = [];

  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push('MIME-Version: 1.0');

  if (opts.ics) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
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
    const { to, subject, body, html, ics, from_name } = await req.json();

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

    // Step 2: Build MIME message
    const raw = buildRawMime({
      from: `${fromName} <${GMAIL_USER}>`,
      to,
      subject,
      text: body,
      html: html || null,
      ics: ics || null,
    });

    // Step 3: Base64url encode
    const encoded = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Step 4: Send via Gmail API
    const sendRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encoded }),
      }
    );
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      throw new Error('Gmail send failed: ' + (sendData.error?.message || JSON.stringify(sendData)));
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Send error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
