// State of the month shown on a planning screen, wired to the write queue
// and to one level of undo (plan-webui §5.2-5.4).

import { api, ApiError, message } from './api.ts';
import { error, toasts } from './toast.svelte.ts';
import { writes, type QueueOwner } from './queue.svelte.ts';
import type { Planning } from './types.ts';
import type { YearMonth } from './logic/dates.ts';
import { toMap, type HalfKey } from './logic/grid.ts';
import { apply, effective, snapshot, toRequests, type Change } from './logic/undo.ts';
import { LABEL, type Status } from './logic/status.ts';

type Undo = { before: Change; month: boolean };

export class PlanningStore implements QueueOwner {
  data = $state<Planning | null>(null);
  map = $state.raw<Map<HalfKey, Status>>(new Map());
  loadError = $state<string | null>(null);
  /** A write failed and the reload did not succeed yet: the screen may show unsaved entries. */
  stale = $state(false);
  #undo: Undo | null = null;
  #req = 0;
  /** Bumped on every local edit: a load that saw one in flight is stale. */
  #edits = 0;

  constructor(
    readonly ym: YearMonth,
    /** null: the signed-in user's own planning. */
    readonly userId: number | null,
  ) {}

  get #target() {
    return this.userId === null ? {} : { user_id: this.userId };
  }

  async load() {
    const req = ++this.#req;
    // Writes still queued (this screen's or a previous one's) go first, so
    // the answer includes them.
    await writes.idle();
    if (req !== this.#req) return;
    const edits = this.#edits;
    const qs = `year=${this.ym.year}&month=${this.ym.month}${this.userId === null ? '' : `&user_id=${this.userId}`}`;
    try {
      const data = await api<Planning>(`/attendance?${qs}`);
      // A later load (or a month change) wins over a late answer.
      if (req !== this.#req) return;
      // Edited while the request was out: the answer misses those writes.
      if (edits !== this.#edits) return void this.load();
      this.data = data;
      this.map = toMap(data.entries);
      this.loadError = null;
      this.stale = false;
    } catch (e) {
      if (req === this.#req) this.loadError = message(e);
    }
  }

  /** Applies `change` on screen at once, then queues its write. */
  commit(change: Change, opts: { undoable?: boolean } = {}): number {
    const eff = effective(change, this.map);
    if (eff.size === 0) return 0;
    const before = snapshot(eff, this.map);
    this.#edits++;
    this.map = apply(eff, this.map);
    this.#queue(eff);
    if (opts.undoable !== false) this.#offerUndo({ before, month: false }, eff);
    return eff.size;
  }

  /** « Tout effacer »: one DELETE /attendance/month. */
  clearMonth(): number {
    const n = this.map.size;
    if (n === 0) return 0;
    const before: Change = new Map(this.map);
    this.#edits++;
    this.map = new Map();
    writes.push(
      () => api('/attendance/month', 'DELETE', { year: this.ym.year, month: this.ym.month, ...this.#target }).then(() => {}),
      this,
    );
    this.#offerUndo({ before, month: true }, null);
    return n;
  }

  undo() {
    const u = this.#undo;
    if (!u) return;
    this.#undo = null;
    toasts.dismissUndo();
    this.#edits++;
    this.map = apply(u.before, this.map);
    this.#queue(u.before);
  }

  forgetUndo() {
    this.#undo = null;
    toasts.dismissUndo();
  }

  #offerUndo(u: Undo, change: Change | null) {
    this.#undo = u;
    const n = u.before.size;
    const statuses = change ? new Set(change.values()) : new Set([null]);
    const what =
      statuses.size === 1 && [...statuses][0]
        ? `en ${LABEL[[...statuses][0] as Status]}`
        : statuses.size === 1
          ? 'effacées'
          : 'modifiées';
    const text = `${n} demi-journée${n > 1 ? 's' : ''} ${what}`;
    // Ctrl+Z works as long as the offer is on screen, not minutes later.
    toasts.show('undo', text, { label: 'Annuler', run: () => this.undo() }, () => {
      if (this.#undo === u) this.#undo = null;
    });
  }

  /** One request per kind of write: upserts, then clears. */
  #queue(change: Change) {
    const { set, clear } = toRequests(change);
    const t = this.#target;
    if (set.length === 1) {
      writes.push(() => api('/attendance', 'PUT', { ...set[0], ...t }).then(() => {}), this);
    } else if (set.length > 1) {
      writes.push(() => api('/attendance/bulk', 'PUT', { entries: set, ...t }).then(() => {}), this);
    }
    if (clear.length === 1) {
      writes.push(() => api('/attendance', 'DELETE', { ...clear[0], ...t }).then(() => {}), this);
    } else if (clear.length > 1) {
      writes.push(() => api('/attendance/bulk', 'DELETE', { entries: clear, ...t }).then(() => {}), this);
    }
  }

  failed(e: unknown) {
    this.stale = true;
    this.forgetUndo();
    if (!(e instanceof ApiError && e.status === 401)) error(message(e));
    void this.load();
  }

  dropped() {
    this.stale = true;
    this.forgetUndo();
    void this.load();
  }
}
