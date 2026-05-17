// tests/unit/helpers.test.js
//
// Unit tests for the four pure helpers on App in js/app.js:
//   - App.esc      → HTML-text escape  (PR #2)
//   - App.escAttr  → JS-string-in-HTML-attribute escape  (PR #2)
//   - App.fmtDate  → date formatter
//   - App.fmtMoney → money formatter
//
// These tests inline the implementations rather than import them — the
// app is a vanilla JS PWA and js/app.js is a script-tag-loaded global,
// not an ES module. Importing it into Vitest would require running a
// jsdom environment with all of App's top-level side-effects stubbed.
//
// >>> MAINTENANCE: if you change App.esc, App.escAttr, App.fmtDate, or
// >>> App.fmtMoney in js/app.js, update the matching function below.
// >>> The implementations MUST stay identical. The Phase-2 plan calls for
// >>> migrating them to a shared js/lib/helpers.js module so this
// >>> duplication goes away.

import { describe, expect, test } from 'vitest';

// ── INLINE COPIES — MUST match js/app.js exactly ─────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function escAttr(str) {
  if (!str) return '';
  const js = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\x3c');
  return js.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const dt = new Date(s + 'T12:00:00');
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function fmtMoney(n) {
  if (!n) return '—';
  return '$' + Number(n).toLocaleString('en-CA');
}

// ── App.esc ──────────────────────────────────────────────────────────────
describe('App.esc — HTML-text escape', () => {
  test('passes null / undefined / empty through to ""', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc('')).toBe('');
  });

  test('escapes ampersand, lt, gt, double-quote', () => {
    expect(esc('a & b')).toBe('a &amp; b');
    expect(esc('<div>')).toBe('&lt;div&gt;');
    expect(esc('say "hi"')).toBe('say &quot;hi&quot;');
  });

  test('escapes single-quote (PR #2 addition)', () => {
    expect(esc("O'Brien")).toBe('O&#39;Brien');
  });

  test('escapes backtick (PR #2 addition)', () => {
    expect(esc('Tag`xss`')).toBe('Tag&#96;xss&#96;');
  });

  test('neutralises a stored-XSS attack string', () => {
    const out = esc('<img src=x onerror=alert(1)>');
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });
});

// ── App.escAttr ──────────────────────────────────────────────────────────
describe('App.escAttr — JS-string-in-HTML-attribute escape', () => {
  test('passes null / undefined / empty through to ""', () => {
    expect(escAttr(null)).toBe('');
    expect(escAttr(undefined)).toBe('');
    expect(escAttr('')).toBe('');
  });

  test("JS-escapes single quote so it can't terminate a JS string literal", () => {
    expect(escAttr("O'Brien")).toBe("O\\'Brien");
  });

  test('neutralises the canonical onclick-injection attack', () => {
    // The attack from AUDIT_REPORT §1.4.1.
    const out = escAttr("');alert('xss');//");
    expect(out).toBe("\\');alert(\\'xss\\');//");
    // After this lands in onclick="X.fn('${escAttr(name)}')" the browser
    // sees JS source `X.fn('\');alert(\'xss\');//')` — a single, intact
    // JS string. alert() never executes.
  });

  test('escapes backslash before anything else (order matters)', () => {
    expect(escAttr('\\')).toBe('\\\\');
    expect(escAttr("a\\b'c")).toBe("a\\\\b\\'c");
  });

  test('escapes < to \\x3c (defence against </script> if ever reused there)', () => {
    expect(escAttr('</script>')).toBe('\\x3c/script>');
  });

  test('JS-escapes line terminators', () => {
    expect(escAttr('line1\nline2')).toBe('line1\\nline2');
    expect(escAttr('a\r\nb')).toBe('a\\r\\nb');
    expect(escAttr('col1\tcol2')).toBe('col1\\tcol2');
  });

  test('HTML-escapes & and " for the outer attribute container', () => {
    expect(escAttr('Smith & Sons')).toBe('Smith &amp; Sons');
    expect(escAttr('say "hi"')).toBe('say \\&quot;hi\\&quot;');
  });
});

// ── App.fmtDate ──────────────────────────────────────────────────────────
describe('App.fmtDate', () => {
  test('returns em-dash for null / undefined / empty', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });

  test('formats a YYYY-MM-DD string as "Mon D" in en-CA', () => {
    // Use a deterministic mid-month date to dodge timezone edge cases.
    expect(fmtDate('2026-05-15')).toBe('May 15');
  });

  test('handles a full Supabase timestamptz by slicing to the date portion', () => {
    expect(fmtDate('2026-05-15T22:30:00.000+00:00')).toBe('May 15');
  });

  test('returns em-dash for unparseable input', () => {
    expect(fmtDate('not-a-date')).toBe('—');
  });
});

// ── App.fmtMoney ─────────────────────────────────────────────────────────
describe('App.fmtMoney', () => {
  test('returns em-dash for falsy input (0 included by current contract)', () => {
    // NOTE: js/app.js uses `if (!n) return '—'`, which treats 0 as missing.
    // Documented contract — if we ever want to render $0, change the
    // helper and update this test.
    expect(fmtMoney(null)).toBe('—');
    expect(fmtMoney(undefined)).toBe('—');
    expect(fmtMoney(0)).toBe('—');
  });

  test('formats integers with Canadian grouping', () => {
    expect(fmtMoney(1)).toBe('$1');
    expect(fmtMoney(1500)).toBe('$1,500');
    expect(fmtMoney(429000)).toBe('$429,000');
    expect(fmtMoney(1234567)).toBe('$1,234,567');
  });

  test('accepts numeric strings', () => {
    expect(fmtMoney('450000')).toBe('$450,000');
  });
});

// ── Privacy mask helpers (PR #14) ─────────────────────────────────────────
//
// Inline copies of App.privateName / App.privateContact — see top-of-file
// note. The contract: every fragment of untrusted input that lands in the
// returned HTML string must be passed through esc(). data-full attributes
// are written escaped and re-escaped on read in revealName/hideName
// (the runtime DOM versions); these tests only cover the pure-HTML
// formatters, which is where the original XSS hole was.

function privateName(fullName) {
  if (!fullName) return '<span style="color:var(--text3);">—</span>';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const safe = esc(fullName);
  return `<span class="pname" data-full="${safe}" onclick="App.revealName(this)" title="Click to expand">${esc(first)}<span class="pname-eye">›</span></span>`;
}

function privateContact(email, phone) {
  const maskEmail = (e) => {
    if (!e) return '';
    const at = e.indexOf('@');
    if (at < 1) return `<span class="pname" data-full="${esc(e)}" onclick="App.revealName(this)" title="Click to reveal">${esc(e[0])}•••<span class="pname-eye">👁</span></span>`;
    const user = e.slice(0, at);
    const domain = e.slice(at + 1);
    const masked = user.length > 2 ? `${user[0]}${'•'.repeat(Math.min(user.length - 1, 4))}@${domain}` : `${user[0]}•@${domain}`;
    return `<span class="pname" data-full="${esc(e)}" onclick="App.revealName(this)" title="Click to reveal email">${esc(masked)}<span class="pname-eye">👁</span></span>`;
  };
  const maskPhone = (p) => {
    if (!p) return '';
    const digits = p.replace(/\D/g, '');
    const masked = digits.length >= 7 ? `${p.slice(0,3)} •••-${digits.slice(-4)}` : `${p.slice(0,3)}•••`;
    return `<span class="pname" data-full="${esc(p)}" onclick="App.revealName(this)" title="Click to reveal phone">${esc(masked)}<span class="pname-eye">👁</span></span>`;
  };
  const parts = [maskEmail(email), maskPhone(phone)].filter(Boolean);
  return parts.join(' · ');
}

describe('App.privateName XSS regression', () => {
  test('renders em-dash placeholder when name is empty', () => {
    expect(privateName('')).toContain('—');
    expect(privateName(null)).toContain('—');
  });

  test('escapes the visible first-name fragment', () => {
    const out = privateName('<script>alert(1)</script> Smith');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('escapes the data-full attribute', () => {
    const out = privateName('Alice "Wonder" <img onerror=alert(1)>');
    // Raw < should never appear except inside our own tag markup
    // (which only uses ASCII tag names).
    const stripped = out.replace(/<span[^>]*>|<\/span>/g, '');
    expect(stripped).not.toContain('<img');
    expect(stripped).not.toContain('onerror=alert');
    expect(out).toContain('&quot;Wonder&quot;');
  });

  test('handles a benign single-name input', () => {
    const out = privateName('Maxwell');
    expect(out).toContain('>Maxwell<');
    expect(out).toContain('data-full="Maxwell"');
  });
});

describe('App.privateContact XSS regression', () => {
  test('returns empty string when both inputs are falsy', () => {
    expect(privateContact('', '')).toBe('');
    expect(privateContact(null, undefined)).toBe('');
  });

  test('escapes a malicious email payload in both data-full and visible mask', () => {
    const out = privateContact('"><svg onload=alert(1)>@x.com', null);
    // The dangerous bit is an injectable <svg> opening tag; the literal
    // text "onload=alert" inside an escaped attribute is harmless.
    expect(out).not.toContain('<svg');
    expect(out).toContain('&lt;svg');
    // The first-char visible fragment should be entity-escaped too
    expect(out).toContain('&quot;');
  });

  test('escapes a malicious phone payload', () => {
    const out = privateContact(null, '<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  test('formats a benign email with the canonical mask', () => {
    const out = privateContact('maxwell@example.com', null);
    // m••••@example.com (4 dots, capped at user.length - 1)
    expect(out).toContain('m••••@example.com');
    expect(out).toContain('data-full="maxwell@example.com"');
  });

  test('formats a benign phone with the canonical mask', () => {
    const out = privateContact(null, '709-555-1234');
    expect(out).toContain('709 •••-1234');
  });
});

// ── Command palette scoring (PR #18) ──────────────────────────────────────
// Inline copy of App.Palette._score — keep in sync with js/app.js.
function paletteScore(label, q) {
  if (!q) return 0;
  const l = label.toLowerCase();
  const qq = q.toLowerCase();
  const i = l.indexOf(qq);
  if (i !== -1) return 1000 - i;
  let li = 0, qi = 0;
  while (li < l.length && qi < qq.length) {
    if (l[li] === qq[qi]) qi++;
    li++;
  }
  return qi === qq.length ? 100 : -Infinity;
}

describe('App.Palette._score', () => {
  test('empty query returns 0 (everything passes through)', () => {
    expect(paletteScore('Clients', '')).toBe(0);
  });

  test('substring match outranks subsequence-only match', () => {
    // "comm" appears as a substring in "Commissions" (substring tier)
    // "csn" does NOT appear contiguously but IS a subsequence (sub tier)
    expect(paletteScore('Commissions', 'comm')).toBeGreaterThan(paletteScore('Commissions', 'csn'));
  });

  test('earlier substring position scores higher', () => {
    expect(paletteScore('Approvals', 'app')).toBeGreaterThan(paletteScore('Manage app', 'app'));
  });

  test('subsequence (chars in order, not contiguous) matches', () => {
    expect(paletteScore('Commissions', 'cmn')).toBe(100); // c,m,n in order
    expect(paletteScore('Clients', 'cls')).toBe(100);
  });

  test('returns -Infinity when no subsequence match', () => {
    expect(paletteScore('Overview', 'xyz')).toBe(-Infinity);
    expect(paletteScore('Clients', 'zzz')).toBe(-Infinity);
  });

  test('is case-insensitive', () => {
    expect(paletteScore('Clients', 'CLI')).toBeGreaterThan(0);
    expect(paletteScore('Clients', 'Cli')).toBeGreaterThan(0);
  });
});
