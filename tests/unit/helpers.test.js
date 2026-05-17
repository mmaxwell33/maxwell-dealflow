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
