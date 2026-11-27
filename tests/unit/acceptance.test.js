// tests/unit/acceptance.test.js
//
// Pins down how accepting an offer works TODAY (Pipeline.createFromOfferWithDates
// in js/offers.js), so later phases can change it knowingly. These are
// characterization tests: they record current behaviour, they do not judge it.
//
// The real js/offers.js is loaded into a vm sandbox with a fake Supabase client
// that records every insert. No network, no real data: all sample values are
// made up.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SRC = read('../../js/dealchecklist.js') + '\n' + read('../../js/offers.js') +
  '\n;this.Pipeline = Pipeline; this.DealChecklist = DealChecklist;';

const AGENT = '00000000-0000-4000-8000-000000000001';
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';

// Fake Supabase: every call chain is recorded; awaiting it returns a result
// chosen by (table, operation).
function fakeDb(log, results) {
  return {
    from(table) {
      const q = { table, op: 'select', payload: null, filters: [] };
      const b = {
        select() { return b; },
        insert(p) { q.op = 'insert'; q.payload = p; return b; },
        update(p) { q.op = 'update'; q.payload = p; return b; },
        upsert(p) { q.op = 'upsert'; q.payload = p; return b; },
        delete() { q.op = 'delete'; return b; },
        eq(k, v) { q.filters.push([k, v]); return b; },
        neq() { return b; }, ilike(k, v) { q.filters.push([k, v]); return b; },
        in() { return b; }, is() { return b; }, not() { return b; }, or() { return b; },
        gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
        single() { return b; }, maybeSingle() { return b; },
        then(res, rej) {
          log.push(q);
          const r = (results[`${table}:${q.op}`] || (() => ({ data: q.op === 'select' ? [] : null, error: null })))(q);
          return Promise.resolve(r).then(res, rej);
        },
        catch() { return b; }
      };
      return b;
    }
  };
}

function load(results = {}) {
  const log = [];
  const toasts = [];
  const activity = [];
  const notified = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    alert() {},
    crypto: webcrypto,
    window: {},
    document: { getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    currentAgent: { id: AGENT, name: 'Sample Agent', email: 'agent@example.com' },
    db: fakeDb(log, {
      'pipeline:insert': () => ({ data: { id: 'pipe-1' }, error: null }),
      'commissions:insert': () => ({ data: { id: 'comm-1' }, error: null }),
      ...results
    }),
    App: {
      getAuthUser: async () => ({ id: AGENT }),
      toast: (m) => toasts.push(m),
      logActivity: async (...a) => activity.push(a),
      esc: s => String(s ?? ''),
    },
    Notify: { onOfferAccepted: async (o, c) => notified.push([o, c]) },
  };
  runInNewContext(SRC, sandbox);
  return { Pipeline: sandbox.Pipeline, log, toasts, activity, notified, sandbox };
}

const offer = (extra = {}) => ({
  client_id: CLIENT_ID,
  client_name: '[Buyer Name]',
  property_address: '1 Sample Street',
  mls_number: '1200000',
  offer_amount: '$350,000',
  offer_date: '2026-11-02',
  conditions: 'Financing, Inspection',
  ...extra
});
const client = { full_name: '[Buyer Name]', email: 'buyer@example.com' };
const dates = (extra = {}) => ({
  ins: '2026-11-09', fin: '2026-11-12', walk: '2026-11-30', close: '2026-12-02',
  newBuild: false, rate: 2.5, basis: 'gross', ...extra
});

const inserts = (log, table) => log.filter(q => q.table === table && q.op === 'insert').map(q => q.payload);

describe('createFromOfferWithDates (current behaviour)', () => {
  test('writes one pipeline row with the dates, both date pairs mirrored', async () => {
    const { Pipeline, log } = load();
    await Pipeline.createFromOfferWithDates(offer(), client, dates());
    const [p] = inserts(log, 'pipeline');
    expect(p).toMatchObject({
      agent_id: AGENT,
      client_id: CLIENT_ID,
      client_name: '[Buyer Name]',
      client_email: 'buyer@example.com',
      property_address: '1 Sample Street',
      mls_number: '1200000',
      offer_amount: 350000,                 // "$350,000" cleaned to a number
      acceptance_date: '2026-11-02',        // the offer date
      inspection_date: '2026-11-09', inspection_deadline: '2026-11-09',
      financing_date: '2026-11-12',  financing_deadline: '2026-11-12',
      walkthrough_date: '2026-11-30',
      closing_date: '2026-12-02',
      status: 'Active',
      deal_type: 'existing_home',
    });
    expect(p.pipeline_id).toMatch(/^[0-9a-f-]{36}$/);
    expect('sale_condition_date' in p).toBe(false);
  });

  test('stage: Conditions when the offer has written conditions, Accepted when clean', async () => {
    let t = load();
    await t.Pipeline.createFromOfferWithDates(offer(), client, dates());
    expect(inserts(t.log, 'pipeline')[0].stage).toBe('Conditions');

    t = load();
    await t.Pipeline.createFromOfferWithDates(offer({ conditions: '' }), client, dates());
    expect(inserts(t.log, 'pipeline')[0].stage).toBe('Accepted');
  });

  test('a sale-of-property date sets Conditions and is saved', async () => {
    const { Pipeline, log } = load();
    await Pipeline.createFromOfferWithDates(offer({ conditions: '' }), client, dates({ sale: '2026-11-20' }));
    const [p] = inserts(log, 'pipeline');
    expect(p.stage).toBe('Conditions');
    expect(p.sale_condition_date).toBe('2026-11-20');
  });

  test('new build: deal_type new_build and starts at Accepted even with conditions', async () => {
    const { Pipeline, log } = load();
    await Pipeline.createFromOfferWithDates(offer(), client, dates({ newBuild: true }));
    const [p] = inserts(log, 'pipeline');
    expect(p.deal_type).toBe('new_build');
    expect(p.stage).toBe('Accepted');
  });

  test('a short or missing client id is dropped rather than risk a bad link', async () => {
    const { Pipeline, log } = load();
    await Pipeline.createFromOfferWithDates(offer({ client_id: 'abc' }), client, dates());
    expect(inserts(log, 'pipeline')[0].client_id).toBeNull();
  });

  test('missing dates are saved as empty, not invented', async () => {
    const { Pipeline, log } = load();
    await Pipeline.createFromOfferWithDates(offer(), client, { newBuild: false });
    const [p] = inserts(log, 'pipeline');
    expect(p.inspection_date).toBeNull();
    expect(p.financing_date).toBeNull();
    expect(p.walkthrough_date).toBeNull();
    expect(p.closing_date).toBeNull();
  });

  test('also writes a commission, the checklist, a notification and an activity entry', async () => {
    const { Pipeline, log, notified, activity } = load();
    await Pipeline.createFromOfferWithDates(offer(), client, dates());
    expect(inserts(log, 'commissions')).toHaveLength(1);
    const checklist = inserts(log, 'deal_checklist')[0];
    expect(checklist.length).toBeGreaterThan(20);
    expect(checklist.every(r => r.pipeline_id === 'pipe-1' && r.agent_id === AGENT)).toBe(true);
    expect(notified).toHaveLength(1);
    expect(activity.map(a => a[0])).toContain('PIPELINE_CREATED');
  });

  test('inspection skipped on the offer: checklist has no inspection tasks', async () => {
    const { Pipeline, log } = load();
    await Pipeline.createFromOfferWithDates(offer({ inspection_skipped: true }), client, dates({ ins: null }));
    const rows = inserts(log, 'deal_checklist')[0];
    expect(rows.some(r => r.category === 'Inspection')).toBe(false);
  });

  test('if the pipeline row cannot be saved, nothing else is written', async () => {
    const { Pipeline, log, notified } = load({
      'pipeline:insert': () => ({ data: null, error: { code: '42501', message: 'denied' } }),
      'pipeline:select': () => ({ data: null, error: null }),
    });
    await Pipeline.createFromOfferWithDates(offer(), client, dates());
    expect(inserts(log, 'commissions')).toHaveLength(0);
    expect(inserts(log, 'deal_checklist')).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });
});
