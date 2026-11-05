// Counts in half-days, shown in days (a half-day is 0,5 j).

import { workdays, type YearMonth } from './dates.ts';
import { STATUSES, type Status } from './status.ts';

export type Counts = Record<Status, number> & { filled: number };

export function countHalves(statuses: Iterable<Status>): Counts {
  const c: Counts = { present: 0, absent: 0, conge: 0, rtt: 0, filled: 0 };
  for (const s of statuses) {
    c[s]++;
    c.filled++;
  }
  return c;
}

export function workHalves(ym: YearMonth): number {
  return workdays(ym).length * 2;
}

/** « 11,5 » for 23 half-days. */
export function days(halves: number): string {
  return (halves / 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

/** Segments of a stacked bar, in status order, then what is left empty. */
export function segments(c: Record<Status, number>, total: number): { key: Status | 'empty'; share: number }[] {
  const sum = STATUSES.reduce((n, s) => n + c[s], 0);
  const base = Math.max(total, sum, 1);
  const out: { key: Status | 'empty'; share: number }[] = STATUSES.filter((s) => c[s] > 0).map((s) => ({
    key: s,
    share: c[s] / base,
  }));
  if (sum < base) out.push({ key: 'empty', share: (base - sum) / base });
  return out;
}

export function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}
