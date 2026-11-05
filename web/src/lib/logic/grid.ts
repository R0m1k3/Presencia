// Half-day keys and the month grid, independent of Svelte.

import { daysInMonth, isoDate, isWeekend, type YearMonth } from './dates.ts';
import { PERIODS, type Period, type Status } from './status.ts';

/** 'YYYY-MM-DD|AM' */
export type HalfKey = `${string}|${Period}`;

export function halfKey(date: string, period: Period): HalfKey {
  return `${date}|${period}`;
}

export function splitKey(k: HalfKey): { date: string; period: Period } {
  const [date, period] = k.split('|') as [string, Period];
  return { date, period };
}

export type Entry = { date: string; period: Period; status: Status };

export function toMap(entries: Entry[]): Map<HalfKey, Status> {
  return new Map(entries.map((e) => [halfKey(e.date, e.period), e.status]));
}

/** Every half-day of the month in reading order (day, then AM before PM). */
export function monthHalves(ym: YearMonth): HalfKey[] {
  const out: HalfKey[] = [];
  for (let d = 1; d <= daysInMonth(ym); d++) for (const p of PERIODS) out.push(halfKey(isoDate(ym, d), p));
  return out;
}

export function dayOf(k: HalfKey): number {
  return Number(k.slice(8, 10));
}

/**
 * The half-days between two ends of a drag, in reading order. Weekends are
 * left out unless the drag starts on one (they stay editable one by one).
 */
export function selectRange(ym: YearMonth, a: HalfKey, b: HalfKey): HalfKey[] {
  const all = monthHalves(ym);
  let i = all.indexOf(a);
  let j = all.indexOf(b);
  if (i < 0 || j < 0) return [];
  if (i > j) [i, j] = [j, i];
  const keepWeekends = isWeekend(ym, dayOf(a));
  return all.slice(i, j + 1).filter((k) => keepWeekends || !isWeekend(ym, dayOf(k)));
}

/** Monday-to-Friday half-days still empty: what « Remplir les jours ouvrés » fills. */
export function emptyWorkHalves(ym: YearMonth, current: Map<HalfKey, Status>): HalfKey[] {
  return monthHalves(ym).filter((k) => !isWeekend(ym, dayOf(k)) && !current.has(k));
}
