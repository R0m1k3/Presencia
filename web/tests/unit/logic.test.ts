import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addMonths, daysInMonth, formatDay, formatStamp, leadingBlanks, monthTitle, parseYm, workdays } from '../../src/lib/logic/dates.ts';
import { emptyWorkHalves, halfKey, monthHalves, selectRange, toMap } from '../../src/lib/logic/grid.ts';
import { apply, effective, snapshot, toRequests, type Change } from '../../src/lib/logic/undo.ts';
import { lockState } from '../../src/lib/logic/lock.ts';
import { countHalves, days, segments, workHalves } from '../../src/lib/logic/totals.ts';
import { filenameFrom } from '../../src/lib/logic/filename.ts';
import { readFileSync } from 'node:fs';
import { STATUSES } from '../../src/lib/logic/status.ts';

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
  // The cadre sees the company lock too, validated or not on their side.
  assert.deepEqual(lockState(company, false), { locked: true, canValidate: false, canReopen: false, banner: 'company' });
  const companyOnly = { editable: false, cadreValidated: false, companyValidated: true };
  assert.deepEqual(lockState(companyOnly, false), { locked: true, canValidate: false, canReopen: false, banner: 'company' });
  // An admin's own validated month stays editable: no « verrouillées » banner.
  assert.deepEqual(lockState(asAdmin, false), { locked: false, canValidate: false, canReopen: false, banner: 'cadre-own-editable' });
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

/** WCAG relative luminance contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('app.css colours meet WCAG AA', () => {
  const css = readFileSync(new URL('../../src/app.css', import.meta.url), 'utf8');
  const v = (name: string) => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, name);
    return m[1];
  };
  for (const s of STATUSES) assert.ok(contrast(v(s), v(`${s}-bg`)) >= 4.5, s);
  for (const t of ['ink', 'ink-2', 'ink-3']) {
    assert.ok(contrast(v(t), v('paper')) >= 4.5, t);
    assert.ok(contrast(v(t), v('bg')) >= 4.5, `${t} sur bg`);
  }
});

test('people: search, ready to validate, filled counts', async () => {
  const { search, isReady, filledText, filledLabel } = await import('../../src/lib/logic/people.ts');
  const list = [
    { full_name: 'Alice Martin', email: 'alice@ui.fr' },
    { full_name: 'Bruno Lefèvre', email: 'bruno@ui.fr' },
  ];
  assert.deepEqual(search(list, '  MART '), [list[0]]);
  assert.deepEqual(search(list, 'ui.fr'), list);
  assert.equal(search(list, ''), list);
  assert.equal(isReady({ companyValidated: false, activeCadres: 2, validatedCadres: 2 }), true);
  assert.equal(isReady({ companyValidated: false, activeCadres: 0, validatedCadres: 0 }), false);
  assert.equal(isReady({ companyValidated: true, activeCadres: 2, validatedCadres: 2 }), false);
  assert.equal(filledText(12, 44), '12/44');
  assert.equal(filledText(46, 44), '46'); // weekends included by the API
  assert.equal(filledLabel(12, 44), '12 sur 44 demi-journées ouvrées renseignées');
});
