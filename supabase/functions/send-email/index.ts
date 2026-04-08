import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fromName = from_name || 'Maxwell Delali Midodzi';
    const fromAddress = 'onboarding@resend.dev';

    // Resend with onboarding@resend.dev can only deliver to the account owner's Gmail.
    // Email goes to your Gmail — reply_to is set to the client so when client replies it comes back to you.
    // You appear as the sender, client replies go to you — exactly like the old App Script flow.
    const AGENT_EMAIL = Deno.env.get('AGENT_EMAIL') || 'maxwelldelali22@gmail.com';

    const payload: Record<string, unknown> = {
      from: `${fromName} <${fromAddress}>`,
      to: [AGENT_EMAIL],
      reply_to: to,          // client email — their replies come back to you
      subject,
      text: body,
    };

    if (html) {
      payload.html = html;
    }

    // Attach .ics calendar invite if provided (base64-encoded)
    if (ics) {
      payload.attachments = [{
        filename: 'viewing.ics',
        content: ics,
        content_type: 'text/calendar; charset=utf-8; method=REQUEST',
      }];
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: result.message || result.name || 'Resend error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
