<script lang="ts">
  // The month grid (or list): click, brush, drag selection, keyboard, and the
  // half-day menu (plan-webui §5.3). It only reports what to write; the
  // planning store does the writing.
  import X from '@lucide/svelte/icons/x';
  import {
    daysInMonth,
    isoDate,
    isWeekend,
    leadingBlanks,
    currentYm,
    monthName,
    weekdayShort,
    type YearMonth,
  } from '../lib/logic/dates.ts';
  import { dayOf, halfKey, monthHalves, selectRange, splitKey, type HalfKey } from '../lib/logic/grid.ts';
  import { LABEL, PERIOD_LABEL, STATUSES, type Status } from '../lib/logic/status.ts';

  type Brush = Status | 'erase' | null;

  let {
    ym,
    map,
    locked,
    brush,
    view,
    onapply,
  }: {
    ym: YearMonth;
    map: Map<HalfKey, Status>;
    locked: boolean;
    brush: Brush;
    view: 'grid' | 'list';
    /** Writes `status` (null: clear) on `keys`. */
    onapply: (keys: HalfKey[], status: Status | null) => void;
  } = $props();

  const now = currentYm();
  const today = $derived(now.year === ym.year && now.month === ym.month ? new Date().getDate() : 0);
  const days = $derived(Array.from({ length: daysInMonth(ym) }, (_, i) => i + 1));
  const halves = $derived(monthHalves(ym));

  let selection = $state<HalfKey[]>([]);
  let anchor = $state<HalfKey | null>(null);
  // The component is re-created for each month (App keys it), so reading the
  // prop once is intended.
  // svelte-ignore state_referenced_locally
  let focusKey = $state<HalfKey>(halfKey(isoDate(ym, 1), 'AM'));
  let dragging = $state(false);
  let menu = $state<{ key: HalfKey; x: number; y: number; above: boolean } | null>(null);
  let root: HTMLElement;

  const selected = $derived(new Set(selection));
  const showBar = $derived(!dragging && !brush && selection.length > 1 && !locked);

  function brushStatus(): Status | null {
    return brush === 'erase' ? null : brush;
  }

  function keyAt(x: number, y: number): HalfKey | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-k]');
    return el && root.contains(el) ? (el.dataset.k as HalfKey) : null;
  }

  function clearSelection() {
    selection = [];
    anchor = null;
  }

  // ---- pointer: mouse, pen, and touch when a brush is active ----
  let down: { key: HalfKey; type: string; dragged: boolean } | null = null;

  function onpointerdown(e: PointerEvent) {
    if (locked || e.button !== 0) return;
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as HalfKey | undefined;
    if (!k) return;
    menu = null;
    down = { key: k, type: e.pointerType, dragged: false };
    if (e.pointerType === 'touch' && !brush) return; // native scroll; a tap opens the menu
    e.preventDefault();
    focusKey = k;
    (document.querySelector(`[data-k="${k}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    anchor = k;
    selection = [k];
    dragging = true;
  }

  function onpointermove(e: PointerEvent) {
    if (!dragging || !anchor) return;
    const k = keyAt(e.clientX, e.clientY);
    if (!k) return;
    if (down && k !== down.key) down.dragged = true;
    selection = selectRange(ym, anchor, k);
  }

  function onpointerup(e: PointerEvent) {
    const d = down;
    down = null;
    if (!d) return;
    if (!dragging) {
      // Touch tap without a brush.
      const k = keyAt(e.clientX, e.clientY);
      if (k === d.key) openMenu(k);
      return;
    }
    dragging = false;
    if (!d.dragged) {
      clearSelection();
      if (brush) onapply([d.key], brushStatus());
      else openMenu(d.key);
      return;
    }
    if (brush) {
      onapply(selection, brushStatus());
      clearSelection();
    }
  }

  function onpointercancel() {
    down = null;
    dragging = false;
  }

  // ---- keyboard ----
  function move(k: HalfKey, dir: 'left' | 'right' | 'up' | 'down'): HalfKey {
    const i = halves.indexOf(k);
    const step = dir === 'left' ? -1 : dir === 'right' ? 1 : (view === 'grid' ? 14 : 2) * (dir === 'up' ? -1 : 1);
    const j = Math.min(halves.length - 1, Math.max(0, i + step));
    return halves[j];
  }

  function onkeydown(e: KeyboardEvent) {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as HalfKey | undefined;
    if (!k || menu) return;
    const arrows: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    };
    if (arrows[e.key]) {
      e.preventDefault();
      const next = move(k, arrows[e.key]);
      if (e.shiftKey) {
        anchor ??= k;
        selection = selectRange(ym, anchor, next);
      } else {
        clearSelection();
      }
      focusKey = next;
      root.querySelector<HTMLElement>(`[data-k="${next}"]`)?.focus();
      return;
    }
    if (locked) return;
    const target = selection.length > 1 ? selection : [k];
    const n = '1234'.indexOf(e.key);
    if (n >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onapply(target, STATUSES[n]);
      clearSelection();
    } else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      onapply(target, null);
      clearSelection();
    } else if (e.key === 'Escape') {
      clearSelection();
    }
  }

  /** Keyboard activation (Enter / Space) of a half-day. */
  function onclick(e: MouseEvent, k: HalfKey) {
    if (e.detail !== 0 || locked) return;
    if (brush) onapply([k], brushStatus());
    else openMenu(k);
  }

  // ---- menu ----
  function openMenu(k: HalfKey) {
    if (locked) return;
    const el = root.querySelector<HTMLElement>(`[data-k="${k}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const above = r.bottom + 300 > innerHeight && r.top > 300;
    const x = Math.min(Math.max(8, r.left), innerWidth - 248);
    menu = { key: k, x, y: above ? r.top - 4 : r.bottom + 4, above };
    clearSelection();
  }

  function closeMenu(refocus = true) {
    const k = menu?.key;
    menu = null;
    if (refocus && k) root.querySelector<HTMLElement>(`[data-k="${k}"]`)?.focus();
  }

  function pick(status: Status | null) {
    if (!menu) return;
    onapply([menu.key], status);
    closeMenu();
  }

  /** « Toute la journée »: the half-day's status, else the brush's, else Présent. */
  function wholeDay() {
    if (!menu) return;
    const { date } = splitKey(menu.key);
    const status = map.get(menu.key) ?? (brush && brush !== 'erase' ? brush : 'present');
    onapply([halfKey(date, 'AM'), halfKey(date, 'PM')], status);
    closeMenu();
  }

  function menuKeydown(e: KeyboardEvent) {
    const n = '1234'.indexOf(e.key);
    if (n >= 0) {
      e.preventDefault();
      pick(STATUSES[n]);
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      pick(null);
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      wholeDay();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % items.length
        : at <= 0 ? items.length - 1 : at - 1;
      items[next]?.focus();
    }
  }

  // The menu itself takes the focus, so Enter means « Toute la journée » and
  // the digits pick a status; the arrows then walk through the items.
  function autofocus(node: HTMLElement) {
    node.focus();
  }

  $effect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) closeMenu(false);
    };
    addEventListener('pointerdown', close, true);
    return () => removeEventListener('pointerdown', close, true);
  });

  function label(k: HalfKey): string {
    const { period } = splitKey(k);
    const d = dayOf(k);
    const s = map.get(k);
    return `${weekdayShort(ym, d)} ${d} ${monthName(ym)}, ${PERIOD_LABEL[period]} : ${s ? LABEL[s] : 'à renseigner'}`;
  }

  const menuTitle = $derived.by(() => {
    if (!menu) return '';
    const { period } = splitKey(menu.key);
    const d = dayOf(menu.key);
    return `${weekdayShort(ym, d)} ${d} ${monthName(ym)}, ${PERIOD_LABEL[period]}`;
  });
</script>

<svelte:window onpointerup={onpointerup} onpointercancel={onpointercancel} />

{#snippet half(date: string, period: 'AM' | 'PM', we: boolean)}
  {@const k = halfKey(date, period)}
  {@const s = map.get(k)}
  <button
    type="button"
    class="half {s ?? ''}"
    class:sel={selected.has(k)}
    data-k={k}
    tabindex={k === focusKey ? 0 : -1}
    aria-label={label(k)}
    aria-haspopup={brush || locked ? undefined : 'menu'}
    aria-disabled={locked || undefined}
    onclick={(e) => onclick(e, k)}
    onfocus={() => (focusKey = k)}
  >{s ? LABEL[s] : we ? '' : PERIOD_LABEL[period]}</button>
{/snippet}

<!-- Delegated pointer and keyboard handling for the half-day buttons inside. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="cal {view}"
  class:locked
  class:painting={!!brush}
  bind:this={root}
  role="group"
  aria-label="Demi-journées du mois"
  {onpointerdown}
  {onpointermove}
  {onkeydown}
>
  {#if view === 'grid'}
    {#each ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as d (d)}
      <div class="dow" aria-hidden="true">{d}</div>
    {/each}
    {#each Array(leadingBlanks(ym)) as _, i (i)}<div class="blank"></div>{/each}
  {/if}
  {#each days as d (d)}
    {@const date = isoDate(ym, d)}
    {@const we = isWeekend(ym, d)}
    <div class="day" class:we class:today={d === today}>
      <div class="n">
        <span>{d}{#if view === 'list'}<span class="wd">{weekdayShort(ym, d)}</span>{/if}</span>
        {#if d === today && view === 'grid'}<span class="tag-today">aujourd’hui</span>{/if}
      </div>
      {@render half(date, 'AM', we)}
      {@render half(date, 'PM', we)}
    </div>
  {/each}
</div>

{#if showBar}
  <div class="selbar" role="toolbar" aria-label="Appliquer à la sélection">
    <span>{selection.length} demi-journées</span>
    {#each STATUSES as s (s)}
      <button type="button" onclick={() => { onapply(selection, s); clearSelection(); }}>{LABEL[s]}</button>
    {/each}
    <button type="button" onclick={() => { onapply(selection, null); clearSelection(); }}>Effacer</button>
    <button type="button" class="close" aria-label="Annuler la sélection" onclick={clearSelection}><X size={16} /></button>
  </div>
{/if}

{#if menu}
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    aria-label={menuTitle}
    style:left="{menu.x}px"
    style:top="{menu.y}px"
    style:transform={menu.above ? 'translateY(-100%)' : undefined}
    onkeydown={menuKeydown}
    use:autofocus
  >
    <p class="menu-title">{menuTitle}</p>
    {#each STATUSES as s, i (s)}
      <button type="button" role="menuitem" class:current={map.get(menu.key) === s} onclick={() => pick(s)}>
        <span class="sw {s}"></span>{LABEL[s]}<kbd>{i + 1}</kbd>
      </button>
    {/each}
    <button type="button" role="menuitem" onclick={() => pick(null)} disabled={!map.has(menu.key)}>
      <span class="sw"></span>Effacer<kbd>⌫</kbd>
    </button>
    <hr />
    <button type="button" role="menuitem" onclick={wholeDay}>Toute la journée<kbd>↵</kbd></button>
  </div>
{/if}

<style>
  .cal { display: grid; grid-template-columns: repeat(5, 1fr) repeat(2, 0.72fr); gap: var(--sp-2); user-select: none; }
  .cal.painting { touch-action: none; }
  .dow { font-size: 13px; color: var(--ink-3); padding: 0 var(--sp-2); }
  .day {
    background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-m); padding: var(--sp-2);
    display: grid; grid-template-rows: auto 1fr 1fr; gap: var(--sp-1); min-height: 108px; min-width: 0;
  }
  .n { font-size: 13px; font-weight: 500; padding: 0 var(--sp-1) 2px; display: flex; justify-content: space-between; gap: var(--sp-1); }
  .tag-today { font-weight: 400; color: var(--ink-3); font-size: 12px; }
  .wd { font-weight: 400; color: var(--ink-3); font-size: 12px; margin-left: var(--sp-1); }
  .list .wd { display: block; margin-left: 0; }
  .day.we { background: var(--weekend); border-color: var(--line-soft); }
  .day.we .n { color: var(--ink-3); font-weight: 400; }
  .day.today { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }

  .half {
    border-radius: var(--r-xs); border: 1px dashed var(--line); background: transparent; display: flex; align-items: center;
    padding: 0 var(--sp-2); font-size: 13px; color: var(--ink-3); min-height: 32px; width: 100%; text-align: left;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    transition: background-color 0.15s var(--ease), border-color 0.15s var(--ease);
  }
  .day.we .half { border-color: transparent; }
  .cal:not(.locked) .half:hover { border-style: solid; border-color: var(--ink-2); }
  .locked .half { cursor: default; }
  .half.present { border: 0; background: var(--present-bg); color: var(--present); font-weight: 500; box-shadow: inset 3px 0 0 var(--present-bar); }
  .half.absent { border: 0; background: var(--absent-bg); color: var(--absent); font-weight: 500; box-shadow: inset 3px 0 0 var(--absent-bar); }
  .half.conge { border: 0; background: var(--conge-bg); color: var(--conge); font-weight: 500; box-shadow: inset 3px 0 0 var(--conge-bar); }
  .half.rtt { border: 0; background: var(--rtt-bg); color: var(--rtt); font-weight: 500; box-shadow: inset 3px 0 0 var(--rtt-bar); }
  .half.sel { outline: 2px solid var(--ink); outline-offset: 1px; }
  .half:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

  /* List: one row a day (always under 900 px). */
  .cal.list { display: flex; flex-direction: column; gap: var(--sp-2); }
  .list .day { grid-template-columns: 72px 1fr 1fr; grid-template-rows: auto; align-items: center; gap: var(--sp-2); min-height: 0; padding: var(--sp-1); }
  .list .n { flex-direction: column; font-size: 15px; line-height: 1.15; padding-left: var(--sp-2); }
  .list .half { min-height: 44px; justify-content: center; font-size: 14px; }
  .list .day.we { padding: 0 var(--sp-1); }

  .selbar {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30; display: flex; align-items: center;
    gap: var(--sp-1); background: var(--ink); color: #fff; border-radius: var(--r-m);
    padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-4); box-shadow: var(--shadow-float); white-space: nowrap;
  }
  .selbar span { font-size: 14px; margin-right: var(--sp-2); }
  .selbar button {
    height: 32px; border: 0; border-radius: var(--r-s); padding: 0 var(--sp-3); background: transparent; color: #fff;
    font-size: 14px; font-weight: 500; display: inline-flex; align-items: center;
  }
  .selbar button:hover { background: rgba(255, 255, 255, 0.12); }
  .selbar .close { padding: 0 var(--sp-2); }

  .menu {
    position: fixed; z-index: 40; width: 240px; background: var(--paper); border: 1px solid var(--line);
    border-radius: var(--r-m); box-shadow: var(--shadow-float); padding: var(--sp-1); display: flex; flex-direction: column;
  }
  .menu-title { font-size: 13px; color: var(--ink-3); padding: var(--sp-2) var(--sp-3) var(--sp-1); }
  .menu button {
    display: flex; align-items: center; gap: var(--sp-2); height: 36px; padding: 0 var(--sp-3); border: 0; background: transparent;
    border-radius: var(--r-s); text-align: left; font-weight: 500;
  }
  .menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--raised); outline: none; }
  .menu button:disabled { color: var(--ink-3); }
  .menu button.current { background: var(--weekend); }
  .menu kbd { margin-left: auto; }
  .menu .sw { width: 8px; height: 8px; border-radius: 2px; }
  .menu hr { border: 0; border-top: 1px solid var(--line-soft); margin: var(--sp-1) 0; }

  @media (max-width: 899px) {
    .selbar { bottom: 140px; max-width: calc(100vw - 24px); overflow-x: auto; }
    .menu button { height: 44px; }
  }
</style>
