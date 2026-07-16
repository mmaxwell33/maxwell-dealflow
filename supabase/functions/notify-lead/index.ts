// ─────────────────────────────────────────────────────────────────────────
// notify-lead — instant email ping when someone submits the website
// Contact form. Anon-invokable (deploy with --no-verify-jwt) so the static
// marketing site can call it, but the Gmail secret NEVER touches the browser:
// this function runs server-side and calls the existing send-email function
// with the service-role key (send-email treats a Bearer <service_role> token
// as a trusted "system call").
//
// The website Contact form calls this AFTER it has already inserted the lead
// via submit_intake(), as a fire-and-forget notification — so if this ever
// fails or isn't deployed yet, the lead is still safely in DealFlow.
//
// Deploy:  supabase functions deploy notify-lead --no-verify-jwt
// (SUPABASE_SERVICE_ROLE_KEY is already present in the project's function env;
//  the Gmail secrets are the same ones send-email already uses.)
// ─────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let payload: Record<string, string> = {};
  try { payload = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  // Deliberately strict: this value can become a Reply-To header, so anything
  // exotic is rejected rather than sanitised. No spaces, no angle brackets, no
  // control characters can survive it.
  const EMAIL_RE = /^[^\s@<>",;:\\]{1,64}@[^\s@<>",;:\\]{1,255}\.[A-Za-z]{2,24}$/;

  const name    = (payload.name    || '').toString().trim().slice(0, 120);
  const email   = (payload.email   || '').toString().trim().slice(0, 160);
  const phone   = (payload.phone   || '').toString().trim().slice(0, 40);
  const message = (payload.message || '').toString().trim().slice(0, 4000);
  const hp      = (payload.company || '').toString().trim(); // honeypot

  // Silently accept bots / empties without emailing (no error leaked).
  if (hp) return json({ ok: true });
  if (!name || !email || !message) return json({ ok: true });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const NOTIFY_TO    = Deno.env.get('AGENT_NOTIFY_EMAIL')
                    || Deno.env.get('GMAIL_USER')
                    || 'Maxwell.Midodzi@exprealty.com';

  // ── Rate limit: cap emails per IP so the form can't be scripted to flood
  //    Maxwell's Gmail. Backed by the lead_rate_limit table (service-role only,
  //    migration 060). Fail-open: if the limiter errors we still send, so a
  //    real lead is never blocked by an infra hiccup.
  const LIMIT = 5, WINDOW_MIN = 60;
  const ip = ((req.headers.get('x-forwarded-for') || '').split(',')[0].trim())
          || req.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
    const q = `${SUPABASE_URL}/rest/v1/lead_rate_limit?ip=eq.${encodeURIComponent(ip)}`
            + `&created_at=gte.${encodeURIComponent(since)}&select=id`;
    const cr = await fetch(q, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
    });
    const total = parseInt(((cr.headers.get('content-range') || '').split('/')[1] || '0'), 10) || 0;
    if (total >= LIMIT) return json({ ok: true }); // silently drop; lead is already saved by submit_intake
    // record this attempt (fire-and-forget)
    fetch(`${SUPABASE_URL}/rest/v1/lead_rate_limit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    }).catch(() => {});
  } catch { /* fail open — never block a genuine lead */ }

  const html = `
    <p><strong>New message from your website Contact form.</strong></p>
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td style="padding:4px 0"><strong>${esc(name)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td style="padding:4px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      ${phone ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td style="padding:4px 0"><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>` : ''}
    </table>
    <p style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap;border-left:3px solid #CC785C;padding-left:14px;color:#333">${esc(message)}</p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#999">Also saved to DealFlow as a new lead. Reply to this person at ${esc(email)}.</p>`;

  const text = `New website Contact message\n\nName: ${name}\nEmail: ${email}\n${phone ? 'Phone: ' + phone + '\n' : ''}\nMessage:\n${message}\n\n(Also saved to DealFlow.)`;

  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`, // system call → send-email trusts it
      },
      body: JSON.stringify({
        to: NOTIFY_TO,
        subject: `New website message from ${name}`,
        body: text,
        html,
        from_name: 'Website Contact Form',
        // So hitting Reply answers the LEAD, not us. Only sent when the address
        // actually looks like an address — this field comes straight off a public
        // form, and send-email strips CR/LF as a second layer. If it fails the
        // check we simply omit it, which is exactly today's behaviour.
        reply_to: EMAIL_RE.test(email) ? email : undefined,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ ok: false, error: 'send-email failed', status: r.status, detail }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
