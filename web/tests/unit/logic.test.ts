import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addMonths, daysInMonth, formatDay, formatStamp, leadingBlanks, monthTitle, parseYm, workdays } from '../../src/lib/logic/dates.ts';
import { emptyWorkHalves, halfKey, monthHalves, selectRange, toMap } from '../../src/lib/logic/grid.ts';
import { apply, effective, snapshot, toRequests, type Change } from '../../src/lib/logic/undo.ts';
import { lockState } from '../../src/lib/logic/lock.ts';
import { countHalves, days, segments, workHalves } from '../../src/lib/logic/totals.ts';
import { filenameFrom } from '../../src/lib/logic/filename.ts';
import { COLORS, STATUSES, contrast } from '../../src/lib/logic/status.ts';

const nov = { year: 2026, month: 11 }; // the 1st is a Sunday

test('months', () => {
  assert.equal(daysInMonth({ year: 2028, month: 2 }), 29);
  assert.equal(daysInMonth(nov), 30);
  assert.equal(leadingBlanks(nov), 6);
  assert.equal(workdays(nov).length, 21);
  assert.deepEqual(addMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(parseYm('2026-11'), nov);
  assert.equal(parseYm('2026-13'), null);
  assert.equal(parseYm('nope'), null);
  assert.equal(monthTitle(nov), 'Novembre 2026');
  assert.equal(formatDay('2026-11-05T07:44:00+00:00'), '5 novembre 2026');
  assert.match(formatStamp('2026-11-05T07:44:00'), /^5 nov\. 2026 à 07:44$/);
});

test('drag selection skips weekends unless it starts on one', () => {
  // Fri 20 PM → Mon 23 AM: 20 PM, 23 AM (21-22 are the weekend).
  const r = selectRange(nov, halfKey('2026-11-20', 'PM'), halfKey('2026-11-23', 'AM'));
  assert.deepEqual(r, ['2026-11-20|PM', '2026-11-23|AM']);
  // Backwards drag gives the same range.
  assert.deepEqual(selectRange(nov, halfKey('2026-11-23', 'AM'), halfKey('2026-11-20', 'PM')), r);
  // Starting on Saturday keeps the weekend.
  assert.equal(selectRange(nov, halfKey('2026-11-21', 'AM'), halfKey('2026-11-23', 'AM')).length, 5);
  assert.equal(monthHalves(nov).length, 60);
});

test('fill work days keeps what is set', () => {
  const cur = toMap([{ date: '2026-11-02', period: 'AM', status: 'conge' }]);
  const empty = emptyWorkHalves(nov, cur);
  assert.equal(empty.length, 41);
  assert.ok(!empty.includes(halfKey('2026-11-02', 'AM')));
  assert.ok(!empty.includes(halfKey('2026-11-01', 'AM')));
});

test('undo restores the state before', () => {
  const cur = toMap([
    { date: '2026-11-02', period: 'AM', status: 'present' },
    { date: '2026-11-02', period: 'PM', status: 'conge' },
  ]);
  const change: Change = new Map([
    [halfKey('2026-11-02', 'AM'), 'rtt'],
    [halfKey('2026-11-02', 'PM'), 'conge'],
    [halfKey('2026-11-03', 'AM'), 'rtt'],
  ]);
  const eff = effective(change, cur);
  assert.equal(eff.size, 2); // 02 PM was already Congé
  const before = snapshot(eff, cur);
  const after = apply(eff, cur);
  assert.equal(after.get(halfKey('2026-11-03', 'AM')), 'rtt');
  assert.deepEqual(apply(before, after), cur);
  const req = toRequests(before);
  assert.deepEqual(req.set, [{ date: '2026-11-02', period: 'AM', status: 'present' }]);
  assert.deepEqual(req.clear, [{ date: '2026-11-03', period: 'AM' }]);
});

test('lock table', () => {
  const open = { editable: true, cadreValidated: false, companyValidated: false };
  assert.deepEqual(lockState(open, false), { locked: false, canValidate: true, canReopen: false, banner: 'none' });
  const cadre = { editable: false, cadreValidated: true, companyValidated: false };
  assert.deepEqual(lockState(cadre, false), { locked: true, canValidate: false, canReopen: false, banner: 'cadre-own' });
  // The admin may still correct a month the cadre validated.
  const asAdmin = { ...cadre, editable: true };
  assert.deepEqual(lockState(asAdmin, true), { locked: false, canValidate: false, canReopen: true, banner: 'cadre-admin' });
  const company = { editable: false, cadreValidated: true, companyValidated: true };
  assert.deepEqual(lockState(company, true), { locked: true, canValidate: false, canReopen: false, banner: 'company' });
});

test('totals', () => {
  const c = countHalves(['present', 'present', 'present', 'conge']);
  assert.equal(c.filled, 4);
  assert.equal(days(c.present), '1,5');
  assert.equal(workHalves(nov), 42);
  const seg = segments(c, 8);
  assert.deepEqual(seg.map((s) => s.key), ['present', 'conge', 'empty']);
  assert.equal(seg.reduce((n, s) => n + s.share, 0), 1);
});

test('download file name', () => {
  assert.equal(
    filenameFrom(`attachment; filename="presences.xlsx"; filename*=UTF-8''presences_Soci%C3%A9t%C3%A9_2026-11.xlsx`, 'x'),
    'presences_Société_2026-11.xlsx',
  );
  assert.equal(filenameFrom('attachment; filename="a.pdf"', 'x'), 'a.pdf');
  assert.equal(filenameFrom(null, 'presences.pdf'), 'presences.pdf');
});

test('status colours meet WCAG AA', () => {
  for (const s of STATUSES) assert.ok(contrast(COLORS[s].fg, COLORS[s].bg) >= 4.5, s);
});
