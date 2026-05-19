// ─────────────────────────────────────────────────────────────────────────
// /api/site-unlock — POST endpoint for the marketing-site password gate
//
// The middleware (middleware.js at repo root) shows a password prompt when
// a visitor hits /site/* without the right cookie. That form POSTs here.
//
// We:
//   1. Parse the form-encoded body for `password` + `return_to`
//   2. Compare password against the SITE_PASSWORD env var
//   3. If match: set the `site-access` HttpOnly cookie (30 days), redirect
//      back to the page they were trying to view
//   4. If no match: redirect back with ?gate_error=1 so the prompt shows
//      an error message
//
// Why HttpOnly: prevents client-side JavaScript from reading the cookie,
// reducing the blast radius if any /site/ page ever has an XSS.
// Why Secure: only sent over HTTPS (Vercel forces HTTPS in production).
// Why SameSite=Lax: standard CSRF defense for cookie-based auth.
// ─────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) {
    // No password configured — gate is effectively off. Redirect home.
    res.writeHead(302, { Location: '/site/' });
    return res.end();
  }

  // Read form-encoded body. Vercel's Node runtime exposes req as a Node
  // IncomingMessage — body needs manual parsing for application/x-www-form-urlencoded.
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    // Defense in depth — don't process arbitrarily large bodies on this endpoint.
    if (body.length > 4096) {
      return res.status(413).end('Payload too large');
    }
  }

  const params = new URLSearchParams(body);
  const submittedPassword = params.get('password') || '';
  const returnTo = sanitizeReturn(params.get('return_to'));

  if (submittedPassword === password) {
    // Match — set cookie + redirect.
    // 30 day Max-Age. Plenty for "I want to come back tomorrow and see it again".
    const cookie = [
      `site-access=${encodeURIComponent(password)}`,
      'Path=/',
      'Max-Age=2592000',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ].join('; ');

    res.setHeader('Set-Cookie', cookie);
    res.writeHead(302, { Location: returnTo });
    return res.end();
  }

  // Wrong password — bounce back with error flag.
  const url = new URL(returnTo, 'https://example.com');
  url.searchParams.set('gate_error', '1');
  const errorRedirect = url.pathname + url.search;

  res.writeHead(302, { Location: errorRedirect });
  return res.end();
}

// ─────────────────────────────────────────────────────────────────────────
// Only allow open redirects back to /site/* — prevents an attacker from
// using this endpoint as a redirect-after-auth gadget pointing at an
// external site they control.
// ─────────────────────────────────────────────────────────────────────────
function sanitizeReturn(raw) {
  if (typeof raw !== 'string' || !raw) return '/site/';
  // Must be a same-origin path starting with /site/ or /site
  if (raw === '/site' || raw === '/site/' || raw.startsWith('/site/')) {
    // Reject protocol-relative URLs like //evil.com
    if (raw.startsWith('//')) return '/site/';
    return raw;
  }
  return '/site/';
}
