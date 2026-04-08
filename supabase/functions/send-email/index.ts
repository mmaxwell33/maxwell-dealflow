import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send email via Gmail SMTP using raw TCP + STARTTLS (no third-party library needed)
// This avoids the Deno.writeAll compatibility issue with older smtp libraries.

function encodeBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

function buildMime(opts: {
  from: string; to: string; subject: string;
  text: string; html?: string | null; ics?: string | null;
}): string {
  const boundary = `_part_${Date.now()}`;
  const inner    = `_inner_${Date.now()}`;
  const lines: string[] = [];

  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push('MIME-Version: 1.0');

  if (opts.ics) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    // text+html part
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
    // ics attachment
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/calendar; charset=UTF-8; method=REQUEST');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('Content-Disposition: attachment; filename="viewing.ics"');
    lines.push('');
    lines.push(opts.ics);
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

// Send via Gmail API using OAuth2 refresh token flow
async function sendViaGmailAPI(opts: {
  gmailUser: string; clientId: string; clientSecret: string; refreshToken: string;
  to: string; subject: string; text: string; html?: string | null; ics?: string | null;
  fromName: string;
}): Promise<void> {
  // 1. Get access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Could not get Gmail access token: ' + JSON.stringify(tokenData));
  }

  // 2. Build raw MIME message
  const raw = buildMime({
    from: `${opts.fromName} <${opts.gmailUser}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    ics: opts.ics,
  });

  // 3. Base64url encode
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 4. Send via Gmail API
  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  const sendData = await sendRes.json();
  if (!sendRes.ok) {
    throw new Error('Gmail API send error: ' + (sendData.error?.message || JSON.stringify(sendData)));
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, subject, body, html, ics, from_name } = await req.json();

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GMAIL_USER          = Deno.env.get('GMAIL_USER')          || 'maxwelldelali22@gmail.com';
    const GMAIL_CLIENT_ID     = Deno.env.get('GMAIL_CLIENT_ID');
    const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET');
    const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN');
    const fromName = from_name || 'Maxwell Delali Midodzi';

    if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN) {
      await sendViaGmailAPI({
        gmailUser: GMAIL_USER,
        clientId: GMAIL_CLIENT_ID,
        clientSecret: GMAIL_CLIENT_SECRET,
        refreshToken: GMAIL_REFRESH_TOKEN,
        to, subject,
        text: body,
        html: html || null,
        ics: ics || null,
        fromName,
      });
      return new Response(JSON.stringify({ success: true, method: 'gmail_api' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fallback: Resend (sends to AGENT_EMAIL since no domain verified)
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (RESEND_API_KEY) {
      const AGENT_EMAIL = Deno.env.get('AGENT_EMAIL') || GMAIL_USER;
      const payload: Record<string, unknown> = {
        from: `${fromName} <onboarding@resend.dev>`,
        to: [AGENT_EMAIL],
        reply_to: to,
        subject,
        text: body,
      };
      if (html) payload.html = html;
      if (ics) payload.attachments = [{ filename: 'viewing.ics', content: ics, content_type: 'text/calendar; charset=utf-8; method=REQUEST' }];

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Resend error');
      return new Response(JSON.stringify({ success: true, method: 'resend' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'No email provider configured. Need GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN in Supabase secrets.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
