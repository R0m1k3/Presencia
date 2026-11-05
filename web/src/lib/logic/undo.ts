// One write action and how to reverse it (plan-webui §5.4).

import { splitKey, type HalfKey } from './grid.ts';
import type { Status } from './status.ts';

/** What the action changes: each half-day's new status, or null to clear it. */
export type Change = Map<HalfKey, Status | null>;

/** The state before `change` for the half-days it touches. */
export function snapshot(change: Change, current: Map<HalfKey, Status>): Change {
  return new Map([...change.keys()].map((k) => [k, current.get(k) ?? null]));
}

/** Drops the half-days whose status would not change. */
export function effective(change: Change, current: Map<HalfKey, Status>): Change {
  return new Map([...change].filter(([k, s]) => (current.get(k) ?? null) !== s));
}

export function apply(change: Change, current: Map<HalfKey, Status>): Map<HalfKey, Status> {
  const next = new Map(current);
  for (const [k, s] of change) {
    if (s) next.set(k, s);
    else next.delete(k);
  }
  return next;
}

/** The API requests that write `change`: upserts and clears, one list each. */
export function toRequests(change: Change): {
  set: { date: string; period: 'AM' | 'PM'; status: Status }[];
  clear: { date: string; period: 'AM' | 'PM' }[];
} {
  const set: { date: string; period: 'AM' | 'PM'; status: Status }[] = [];
  const clear: { date: string; period: 'AM' | 'PM' }[] = [];
  for (const [k, s] of change) {
    const { date, period } = splitKey(k);
    if (s) set.push({ date, period, status: s });
    else clear.push({ date, period });
  }
  return { set, clear };
}
