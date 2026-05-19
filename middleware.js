// ─────────────────────────────────────────────────────────────────────────
// Site password gate — Vercel framework-agnostic middleware
//
// Why this exists: the marketing site at /site/* is in private preview while
// Maxwell shares it with family + close friends. We want anyone visiting any
// /site/* URL to enter a shared password before the page renders. Everything
// else on the deployment (CRM at /, client respond/portal pages, intake
// forms) is unaffected — those have their own auth or are intentionally
// public.
//
// How it works:
//   1. Visitor hits /site/anything
//   2. We read the `site-access` cookie
//   3. If the cookie value === env.SITE_PASSWORD, we let the request through
//      (return undefined) and Vercel serves the underlying static file
//   4. Otherwise we return a 401 with a clean password prompt page
//   5. The prompt form POSTs to /api/site-unlock which sets the cookie
//
// To remove the gate: delete this file + api/site-unlock.js, remove the
// SITE_PASSWORD env var on Vercel. One PR each direction.
//
// Safety net: if SITE_PASSWORD is not set in the environment (e.g. someone
// deploys without configuring it), the middleware passes everything through.
// This prevents a missing env var from locking out the entire marketing site.
// ─────────────────────────────────────────────────────────────────────────

export const config = {
  // Match every URL under /site/ (and /site itself). Other routes are
  // untouched — CRM at /, client respond/portal pages, intake forms, etc.
  matcher: ['/site', '/site/:path*'],
};

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD;

  // Safety: if the env var isn't configured, don't lock anyone out.
  // This means production with SITE_PASSWORD unset behaves like before.
  if (!password) return;

  // Parse the site-access cookie out of the Cookie header.
  // We avoid request.cookies in case it's not available in this runtime.
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)site-access=([^;]+)/);
  const cookieValue = match ? decodeURIComponent(match[1]) : null;

  if (cookieValue === password) {
    // Cookie checks out — let Vercel serve the underlying file.
    return;
  }

  // Cookie missing or wrong — show the password prompt.
  const url = new URL(request.url);
  const returnTo = url.pathname + url.search;
  const showError = url.searchParams.get('gate_error') === '1';

  return new Response(promptHTML(returnTo, showError), {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      // Don't let search engines index the gate page itself.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// The password prompt page. Inline HTML so the middleware is self-contained
// and the gate works even if the deployment is otherwise broken.
//
// Note: we HTML-escape returnTo to defend against injection if a visitor
// hits e.g. /site/"><script>... — that path becomes the form's hidden field
// value, so escaping is essential.
// ─────────────────────────────────────────────────────────────────────────
function promptHTML(returnTo, showError) {
  const escaped = String(returnTo)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const errorBlock = showError
    ? `<div class="err" role="alert">That password didn't match. Try again.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Preview access — Maxwell Midodzi</title>
<style>
  :root {
    --brand: #c44d36;
    --brand-dark: #a83a26;
    --ink: #1a1a1a;
    --ink-2: #555;
    --ink-3: #888;
    --bg: #fafaf7;
    --border: #e5e0d8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--ink);
    padding: 24px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .gate { max-width: 380px; width: 100%; }
  .gate-brand {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 28px; font-size: 14px;
    letter-spacing: 0.04em; color: var(--ink-3); text-transform: uppercase;
  }
  .gate-dot { width: 8px; height: 8px; background: var(--brand); border-radius: 50%; }
  .gate h1 {
    font-size: 24px; margin: 0 0 10px;
    letter-spacing: -0.02em; line-height: 1.2;
  }
  .gate p.sub {
    color: var(--ink-2); font-size: 14.5px;
    line-height: 1.55; margin: 0 0 24px;
  }
  .err {
    background: #fef2f0; border: 1px solid #f4d3cc; color: #8c2c1c;
    padding: 10px 12px; border-radius: 8px; font-size: 13.5px; margin-bottom: 14px;
  }
  .gate input[type="password"] {
    width: 100%; padding: 13px 14px;
    border: 1px solid var(--border); border-radius: 9px;
    font-size: 16px; font-family: inherit;
    background: #fff;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .gate input[type="password"]:focus {
    outline: none; border-color: var(--brand);
    box-shadow: 0 0 0 3px rgba(196, 77, 54, 0.15);
  }
  .gate button {
    width: 100%; padding: 13px;
    margin-top: 10px; background: var(--ink); color: #fff;
    border: 0; border-radius: 9px;
    font-size: 15px; font-weight: 600; cursor: pointer;
    font-family: inherit;
    transition: background 120ms;
  }
  .gate button:hover { background: var(--brand); }
  .gate button:active { background: var(--brand-dark); }
  .footnote {
    color: var(--ink-3); font-size: 12.5px;
    margin-top: 32px; line-height: 1.55;
  }
  .footnote a { color: var(--ink-2); }
</style>
</head>
<body>
  <main class="gate">
    <div class="gate-brand"><span class="gate-dot"></span><span>Maxwell Midodzi · Preview</span></div>
    <h1>This site is in preview.</h1>
    <p class="sub">Maxwell's marketing site is currently shared with family and close friends for feedback. Enter the password to take a look.</p>
    ${errorBlock}
    <form method="POST" action="/api/site-unlock">
      <input type="hidden" name="return_to" value="${escaped}">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required minlength="1">
      <button type="submit">Continue</button>
    </form>
    <p class="footnote">If you don't have the password, reach out to Maxwell directly at <a href="mailto:Maxwell.Midodzi@exprealty.com">Maxwell.Midodzi@exprealty.com</a>.</p>
  </main>
</body>
</html>`;
}
