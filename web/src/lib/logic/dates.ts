// Months and days, in local calendar terms (dates are 'YYYY-MM-DD' strings,
// as the API sends them; no time zone is involved).

export type YearMonth = { year: number; month: number }; // month 1-12

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymKey({ year, month }: YearMonth): string {
  return `${year}-${pad(month)}`;
}

/** 'YYYY-MM' → YearMonth, or null when malformed or out of range. */
export function parseYm(s: string | undefined): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100 ? { year, month } : null;
}

export function currentYm(now = new Date()): YearMonth {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(year, month, 0).getDate();
}

export function isoDate({ year, month }: YearMonth, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday({ year, month }: YearMonth, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

export function isWeekend(ym: YearMonth, day: number): boolean {
  const w = weekday(ym, day);
  return w === 0 || w === 6;
}

/** Monday-first column of the 1st of the month (0 = Monday). */
export function leadingBlanks(ym: YearMonth): number {
  return (weekday(ym, 1) + 6) % 7;
}

export function workdays(ym: YearMonth): number[] {
  const days: number[] = [];
  for (let d = 1; d <= daysInMonth(ym); d++) if (!isWeekend(ym, d)) days.push(d);
  return days;
}

export function monthName(ym: YearMonth): string {
  return MONTHS[ym.month - 1];
}

/** « Novembre 2026 ». */
export function monthTitle(ym: YearMonth): string {
  const n = monthName(ym);
  return `${n[0].toUpperCase()}${n.slice(1)} ${ym.year}`;
}

export function weekdayShort(ym: YearMonth, day: number): string {
  return WEEKDAYS_SHORT[weekday(ym, day)];
}

/** « 5 nov. 2026 à 07:44 » from an ISO timestamp, in the browser's zone. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** « 5 novembre 2026 » from 'YYYY-MM-DD' or an ISO timestamp. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** The last `n` months, most recent first, ending at `from`. */
export function lastMonths(from: YearMonth, n: number): YearMonth[] {
  return Array.from({ length: n }, (_, i) => addMonths(from, -i));
}
