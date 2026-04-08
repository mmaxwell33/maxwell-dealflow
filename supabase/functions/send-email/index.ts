import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, subject, body, html, ics, from_name } = await req.json();

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GMAIL_USER = Deno.env.get('GMAIL_USER');
    const GMAIL_PASS = Deno.env.get('GMAIL_APP_PASS');

    if (!GMAIL_USER || !GMAIL_PASS) {
      return new Response(JSON.stringify({ error: 'GMAIL_USER or GMAIL_APP_PASS not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const htmlContent = html || null;
    const textContent = body;

    const client = new SmtpClient();
    await client.connectTLS({
      hostname: 'smtp.gmail.com',
      port: 465,
      username: GMAIL_USER,
      password: GMAIL_PASS,
    });

    const msgOptions: Record<string, unknown> = {
      from: `${from_name || 'Maxwell Delali Midodzi'} <${GMAIL_USER}>`,
      to: to,
      subject: subject,
      content: textContent,
    };

    if (htmlContent) {
      msgOptions.html = htmlContent;
    }

    // Attach .ics calendar invite if provided
    if (ics) {
      msgOptions.attachments = [{
        filename: 'viewing.ics',
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        encoding: 'base64',
        content: ics,
      }];
    }

    await client.send(msgOptions);
    await client.close();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
