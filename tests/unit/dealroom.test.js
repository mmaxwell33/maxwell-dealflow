// tests/unit/dealroom.test.js
//
// Tests the real js/dealroom.js in a vm sandbox with a fake database and a
// fake localStorage. Made-up sample data only.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SRC = readFileSync(new URL('../../js/dealroom.js', import.meta.url), 'utf8') + '\n;this.DealRoom = DealRoom;';

const DOCS = [{ name: 'Doc A' }, { name: 'Doc B' }, { name: 'Doc C' }];
const AGENT = { name: 'Sample Agent', role: 'Agent', email: 'agent@example.com', phone: '' };
const BUYER = { name: '[Buyer Name]', role: 'Buyer', email: 'buyer@example.com', phone: '' };

function setup({ row = null, local = {}, dbError = null, saveError = null } = {}) {
  const store = { ...local };
  const saves = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    currentAgent: { id: 'agent-1' },
    App: { toast() {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    db: {
      from: () => ({
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: row, error: dbError }),
        upsert: async (payload) => { saves.push(payload); return { error: saveError }; },
      }),
    },
  };
  runInNewContext(SRC, sandbox);
  return { DealRoom: sandbox.DealRoom, store, saves };
}

describe('DealRoom pure helpers', () => {
  const { DealRoom } = setup();
  test('mergeParties removes duplicates by name and email, case-insensitive', () => {
    const out = DealRoom.mergeParties([AGENT, BUYER], [{ ...BUYER, name: '[BUYER NAME]', email: 'BUYER@example.com' }]);
    expect(out).toHaveLength(2);
  });
  test('mergeParties drops rows with no name', () => {
    expect(DealRoom.mergeParties([{ name: '  ', email: 'x@example.com' }], [])).toHaveLength(0);
  });
  test('index ticks convert to names and back', () => {
    const names = DOCS.map(d => d.name);
    expect(DealRoom.indexesToNames([2, 0, 0, 9], names)).toEqual(['Doc C', 'Doc A']);
    expect(DealRoom.namesToIndexes(['Doc C', 'Gone'], names)).toEqual([2]);
  });
});

describe('DealRoom.load', () => {
  test('first visit: saves the default parties to the database', async () => {
    const { DealRoom, saves } = setup();
    const s = await DealRoom.load('deal-1', [AGENT, BUYER]);
    expect(s.parties).toHaveLength(2);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ pipeline_id: 'deal-1', agent_id: 'agent-1' });
  });

  test('saved row is used as is and nothing is re-saved', async () => {
    const lawyer = { name: 'Sample Lawyer', role: 'Lawyer / Notary', email: 'law@example.com', phone: '' };
    const { DealRoom, saves } = setup({ row: { parties: [AGENT, BUYER, lawyer], docs_done: ['Doc B'] } });
    const s = await DealRoom.load('deal-1', [AGENT, BUYER]);
    expect(s.parties).toHaveLength(3);
    expect(DealRoom.checkedIndexes('deal-1', DOCS)).toEqual([1]);
    expect(saves).toHaveLength(0);
  });

  test('old device copy is merged into the database, then cleared', async () => {
    const inspector = { name: 'Sample Inspector', role: 'Home Inspector', email: 'insp@example.com', phone: '' };
    const { DealRoom, saves, store } = setup({
      row: { parties: [AGENT, BUYER], docs_done: [] },
      local: { 'df-room-deal-1': JSON.stringify([AGENT, BUYER, inspector]) },
    });
    const s = await DealRoom.load('deal-1', [AGENT, BUYER]);
    expect(s.parties.map(p => p.name)).toContain('Sample Inspector');
    expect(s.parties).toHaveLength(3);
    expect(saves).toHaveLength(1);
    expect(store['df-room-deal-1']).toBeUndefined();
  });

  test('old position-based ticks become names when the doc list is drawn', async () => {
    const { DealRoom, saves, store } = setup({
      local: { 'df-room-docs-deal-1': JSON.stringify([0, 2]) },
    });
    await DealRoom.load('deal-1', [AGENT, BUYER]);
    expect(store['df-room-docs-deal-1']).toBeDefined();          // kept until moved
    expect(DealRoom.checkedIndexes('deal-1', DOCS)).toEqual([0, 2]);
    await new Promise(r => setTimeout(r, 0));
    expect(saves.at(-1).docs_done).toEqual(['Doc A', 'Doc C']);
    expect(store['df-room-docs-deal-1']).toBeUndefined();
  });

  test('database unavailable: keeps working from this device, clears nothing', async () => {
    const { DealRoom, saves, store } = setup({
      dbError: { message: 'relation "deal_room" does not exist' },
      local: { 'df-room-deal-1': JSON.stringify([AGENT, BUYER]), 'df-room-docs-deal-1': '[1]' },
    });
    const s = await DealRoom.load('deal-1', [AGENT, BUYER]);
    expect(s.parties).toHaveLength(2);
    expect(DealRoom.checkedIndexes('deal-1', DOCS)).toEqual([1]);
    DealRoom.toggleDoc('deal-1', 0);
    expect(JSON.parse(store['df-room-docs-deal-1'])).toEqual([0, 1]);
    expect(saves).toHaveLength(0);
  });

  test('a failed save never clears the device copy', async () => {
    const { DealRoom, store } = setup({
      saveError: { message: 'denied' },
      local: { 'df-room-deal-1': JSON.stringify([AGENT]) },
    });
    await DealRoom.load('deal-1', [AGENT, BUYER]);
    expect(store['df-room-deal-1']).toBeDefined();
  });
});

describe('DealRoom parties and ticks', () => {
  test('add, remove and toggle save the whole room', async () => {
    const { DealRoom, saves } = setup({ row: { parties: [AGENT, BUYER], docs_done: [] } });
    await DealRoom.load('deal-1', [AGENT, BUYER]);
    await DealRoom.addParty('deal-1', { name: 'Sample Broker', role: 'Mortgage Broker', email: 'b@example.com' });
    expect(DealRoom.parties('deal-1')).toHaveLength(3);
    await DealRoom.addParty('deal-1', { name: 'Sample Broker', role: 'Mortgage Broker', email: 'b@example.com' });
    expect(DealRoom.parties('deal-1')).toHaveLength(3);             // no duplicate
    await DealRoom.removeParty('deal-1', 2);
    expect(DealRoom.parties('deal-1')).toHaveLength(2);
    DealRoom.checkedIndexes('deal-1', DOCS);
    DealRoom.toggleDoc('deal-1', 1);
    expect(saves.at(-1).docs_done).toEqual(['Doc B']);
    DealRoom.toggleDoc('deal-1', 1);
    expect(saves.at(-1).docs_done).toEqual([]);
  });
});
