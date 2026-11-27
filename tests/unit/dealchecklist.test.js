// tests/unit/dealchecklist.test.js
//
// Tests the real js/dealchecklist.js (loaded as a browser script in a vm
// sandbox, so there is no inline copy to keep in sync). Sample data is made up.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src = readFileSync(new URL('../../js/dealchecklist.js', import.meta.url), 'utf8');
const sandbox = {};
runInNewContext(src + '\n;this.DealChecklist = DealChecklist;', sandbox);
const { DealChecklist } = sandbox;

const INSPECTION = t => t.category === 'Inspection';

describe('DealChecklist.addDays', () => {
  test('adds calendar days', () => {
    expect(DealChecklist.addDays('2026-11-27', 3)).toBe('2026-11-30');
    expect(DealChecklist.addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(DealChecklist.addDays('2026-03-05', -3)).toBe('2026-03-02');
  });
  test('daylight-saving changes never move the date', () => {
    // NL springs forward 2026-03-08 and falls back 2026-11-01
    expect(DealChecklist.addDays('2026-03-01', 10)).toBe('2026-03-11');
    expect(DealChecklist.addDays('2026-10-20', 30)).toBe('2026-11-19');
  });
  test('accepts a full timestamp and uses its date part', () => {
    expect(DealChecklist.addDays('2026-11-27T15:00:00+00:00', 1)).toBe('2026-11-28');
  });
  test('bad input gives null, not a wrong date', () => {
    expect(DealChecklist.addDays(null, 1)).toBeNull();
    expect(DealChecklist.addDays('soon', 1)).toBeNull();
  });
});

describe('DealChecklist.tasks', () => {
  const accept = '2026-11-02';

  test('with an inspection: all four inspection tasks', () => {
    const t = DealChecklist.tasks({ inspection_date: '2026-11-09' }, accept);
    expect(t.filter(INSPECTION)).toHaveLength(4);
    expect(t.find(x => x.title.startsWith('Ensure inspection')).due).toBe('2026-11-09');
  });

  test('inspection skipped: no inspection tasks at all', () => {
    const t = DealChecklist.tasks({ inspection_skipped: true }, accept);
    expect(t.filter(INSPECTION)).toHaveLength(0);
    expect(t.some(x => /inspection/i.test(x.title))).toBe(false);
  });

  test('sale-of-property task only when there is a sale condition date', () => {
    const sale = /sale-of-property/;
    expect(DealChecklist.tasks({}, accept).some(x => sale.test(x.title))).toBe(false);
    const t = DealChecklist.tasks({ sale_condition_date: '2026-11-20' }, accept);
    expect(t.find(x => sale.test(x.title)).due).toBe('2026-11-20');
  });

  test('defaults from acceptance when the offer has no dates', () => {
    const t = DealChecklist.tasks({}, accept);
    const due = title => t.find(x => x.title.startsWith(title)).due;
    expect(due('Ensure financing')).toBe('2026-11-12');       // +10
    expect(due('Conduct final walkthrough')).toBe('2026-11-30'); // +28
    expect(due('Coordinate key handover')).toBe('2026-12-02');   // +30
  });

  test('closing-based tasks follow the closing date', () => {
    const t = DealChecklist.tasks({ closing_date: '2026-12-15' }, accept);
    const due = title => t.find(x => x.title.startsWith(title)).due;
    expect(due('Confirm closing costs')).toBe('2026-12-12');   // closing - 3
    expect(due('Coordinate key handover')).toBe('2026-12-15');
    expect(due('Post-closing')).toBe('2026-12-18');            // closing + 3
  });

  test('every task has a title, category and valid date', () => {
    for (const x of DealChecklist.tasks({ sale_condition_date: '2026-11-20' }, accept)) {
      expect(x.title).toBeTruthy();
      expect(x.category).toBeTruthy();
      expect(x.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
