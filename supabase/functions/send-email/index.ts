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
    const { to, subject, body, html, from_name } = await req.json();

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GMAIL_USER = Deno.env.get('GMAIL_USER');       // maxwelldelali22@gmail.com
    const GMAIL_PASS = Deno.env.get('GMAIL_APP_PASS');   // 16-char Gmail App Password

    if (!GMAIL_USER || !GMAIL_PASS) {
      return new Response(JSON.stringify({ error: 'GMAIL_USER or GMAIL_APP_PASS not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine if body is HTML or plain text
    const isHtml = (body && body.trim().startsWith('<!DOCTYPE')) || body?.trim().startsWith('<html');
    const htmlContent = html || (isHtml ? body : null);
    const textContent = isHtml ? body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : body;

    const client = new SmtpClient();
    await client.connectTLS({
      hostname: 'smtp.gmail.com',
      port: 465,
      username: GMAIL_USER,
      password: GMAIL_PASS,
    });

    await client.send({
      from: `${from_name || 'Maxwell Delali Midodzi'} <${GMAIL_USER}>`,
      to: to,
      subject: subject,
      content: textContent,
      html: htmlContent || undefined,
    });

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
