<script lang="ts">
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import Brush from '@lucide/svelte/icons/brush';
  import Check from '@lucide/svelte/icons/check';
  import Eraser from '@lucide/svelte/icons/eraser';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import X from '@lucide/svelte/icons/x';
  import MonthNav from '../components/MonthNav.svelte';
  import Ribbon from '../components/Ribbon.svelte';
  import Calendar from '../components/Calendar.svelte';
  import LockBanner from '../components/LockBanner.svelte';
  import { PlanningStore } from '../lib/planning.svelte.ts';
  import { api, message } from '../lib/api.ts';
  import { writes } from '../lib/queue.svelte.ts';
  import { confirm } from '../lib/confirm.svelte.ts';
  import { ok, error } from '../lib/toast.svelte.ts';
  import { lockState } from '../lib/logic/lock.ts';
  import { emptyWorkHalves, type HalfKey } from '../lib/logic/grid.ts';
  import { countHalves, days, workHalves } from '../lib/logic/totals.ts';
  import { monthName, ymKey, type YearMonth } from '../lib/logic/dates.ts';
  import { LABEL, STATUSES, type Status } from '../lib/logic/status.ts';
  import type { Change } from '../lib/logic/undo.ts';
  import type { UserRow } from '../lib/types.ts';

  let { ym, userId }: { ym: YearMonth; userId: number | null } = $props();

  // App re-creates this screen for each month and user: reading the props
  // once is intended.
  // svelte-ignore state_referenced_locally
  const store = new PlanningStore(ym, userId);
  const narrow = new MediaQuery('max-width: 899px');
  let brush = $state<Status | 'erase' | null>(null);
  let chosenView = $state<'grid' | 'list'>((sessionStorage.getItem('presencia.view') as 'grid' | 'list') ?? 'grid');
  const view = $derived(narrow.current ? 'list' : chosenView);
  let who = $state<UserRow | null>(null);
  let busy = $state(false);

  // svelte-ignore state_referenced_locally
  const viewingOther = userId !== null;
  const lock = $derived(store.data ? lockState(store.data, viewingOther) : null);
  // Read-only while the screen may show entries the server does not have.
  const locked = $derived((lock?.locked ?? true) || store.stale);
  const counts = $derived(countHalves(store.map.values()));
  const totalHalves = $derived(workHalves(ym));
  const workFilled = $derived(totalHalves - emptyWorkHalves(ym, store.map).length);
  const href = (m: YearMonth) => (viewingOther ? `#/plannings/${userId}/${ymKey(m)}` : `#/planning/${ymKey(m)}`);

  onMount(() => {
    void store.load();
    if (viewingOther) {
      api<UserRow[]>('/users')
        .then((list) => (who = list.find((u) => u.id === userId) ?? null))
        .catch(() => {});
    }
    return () => store.forgetUndo();
  });

  $effect(() => {
    if (locked) brush = null;
  });

  function setView(v: 'grid' | 'list') {
    chosenView = v;
    sessionStorage.setItem('presencia.view', v);
  }

  function apply(keys: HalfKey[], status: Status | null) {
    if (locked || keys.length === 0) return;
    store.commit(new Map(keys.map((k) => [k, status])) as Change);
  }

  function fill() {
    const keys = emptyWorkHalves(ym, store.map);
    if (keys.length === 0) return ok('Tous les jours ouvrés sont déjà renseignés');
    apply(keys, 'present');
  }

  async function clearAll() {
    const n = store.map.size;
    if (n === 0) return ok('Rien à effacer ce mois-ci');
    const yes = await confirm(
      'Tout effacer',
      `Effacer les ${n} demi-journée${n > 1 ? 's' : ''} saisies en ${monthName(ym)} ${ym.year} ? Vous pourrez annuler juste après.`,
      'Tout effacer',
      true,
    );
    if (yes) store.clearMonth();
  }

  async function validate() {
    const empty = emptyWorkHalves(ym, store.map).length;
    const text =
      (empty ? `${empty} demi-journée${empty > 1 ? 's' : ''} ouvrée${empty > 1 ? 's restent vides' : ' reste vide'}. ` : '') +
      'Une fois validé, le mois est transmis à l’administrateur et vos saisies sont verrouillées.';
    const mark = writes.mark();
    if (!(await confirm(`Valider ${monthName(ym)} ${ym.year}`, text, 'Valider le mois'))) return;
    busy = true;
    try {
      // A write failed (and the rest was dropped): validating now would lock
      // the month without it. The failure was already shown.
      if (!(await writes.settled(mark)) || store.stale) return;
      store.forgetUndo();
      await api('/validations/cadre', 'POST', { year: ym.year, month: ym.month });
      ok('Mois validé et transmis à l’administrateur');
    } catch (e) {
      error(message(e));
    } finally {
      busy = false;
      void store.load();
    }
  }

  async function reopen() {
    const name = who?.full_name ?? 'ce cadre';
    const mark = writes.mark();
    if (!(await confirm('Réouvrir le mois', `${name} pourra de nouveau modifier ${monthName(ym)} ${ym.year}.`, 'Réouvrir'))) return;
    busy = true;
    try {
      if (!(await writes.settled(mark)) || store.stale) return;
      store.forgetUndo();
      await api('/validations/cadre/reopen', 'POST', { user_id: userId, year: ym.year, month: ym.month });
      ok('Mois réouvert');
    } catch (e) {
      error(message(e));
    } finally {
      busy = false;
      void store.load();
    }
  }

  function toggleBrush(b: Status | 'erase') {
    brush = brush === b ? null : b;
  }

  function onkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, dialog')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      store.undo();
      return;
    }
    // Brush shortcuts when the focus is not on a half-day (there, the keys
    // write directly).
    if (t.closest('[data-k], .menu') || e.ctrlKey || e.metaKey || e.altKey || locked) return;
    const n = '1234'.indexOf(e.key);
    if (n >= 0) toggleBrush(STATUSES[n]);
    else if (e.key === '0') toggleBrush('erase');
    else if (e.key === 'Escape') brush = null;
  }
</script>

<svelte:window {onkeydown} />

<div class="page planning">
  {#if viewingOther}
    <a class="back" href="#/plannings/{ymKey(ym)}"><ArrowLeft size={16} />Tous les plannings</a>
  {/if}
  <header class="head">
    <div>
      <MonthNav {ym} {href} big />
      {#if viewingOther}
        <p class="page-sub">{who ? `${who.full_name}${who.company_name ? `, ${who.company_name}` : ''}` : ' '}</p>
      {/if}
    </div>
    {#if lock}
      <div class="actions desktop">
        {#if !locked}
          <button class="btn ghost" type="button" onclick={clearAll}><X />Tout effacer</button>
          <button class="btn" type="button" onclick={fill}><ListChecks />Remplir les jours ouvrés</button>
        {/if}
        {#if lock.canValidate}
          <button class="btn primary" type="button" disabled={busy} onclick={validate}><Check />Valider le mois</button>
        {/if}
        {#if lock.canReopen}
          <button class="btn" type="button" disabled={busy} onclick={reopen}><RotateCcw />Réouvrir le mois</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if store.loadError && !store.data}
    <div class="panel empty" role="alert">
      <p>{store.loadError}</p>
      <button class="btn" type="button" onclick={() => store.load()}>Réessayer</button>
    </div>
  {:else if store.data && lock}
    <section class="summary" aria-label="Le mois en un coup d’œil">
      <Ribbon {ym} map={store.map} />
      <p class="tally">
        <span><strong>{workFilled}</strong> demi-journées ouvrées sur {totalHalves} renseignées</span>
        {#each STATUSES as s (s)}
          <span class="k"><span class="sw {s}"></span><strong>{days(counts[s])} j</strong> {s === 'rtt' ? 'RTT' : LABEL[s].toLowerCase()}</span>
        {/each}
      </p>
    </section>

    {#if store.stale && store.loadError}
      <div class="panel stale" role="alert">
        <p>Le planning n’a pas pu être rechargé : les cases affichées ne sont peut-être pas enregistrées. {store.loadError}</p>
        <button class="btn small" type="button" onclick={() => store.load()}>Réessayer</button>
      </div>
    {/if}
    <LockBanner banner={lock.banner} cadreAt={store.data.cadreValidatedAt} companyAt={store.data.companyValidatedAt} />

    {#if !locked || lock.canValidate || lock.canReopen}
      <div class="actions mobile">
        {#if !locked}
          <button class="icon-btn" type="button" onclick={clearAll} aria-label="Tout effacer" title="Tout effacer"><X /></button>
          <button class="btn" type="button" onclick={fill}><ListChecks />Jours ouvrés</button>
        {/if}
        {#if lock.canValidate}
          <button class="btn primary" type="button" disabled={busy} onclick={validate}><Check />Valider le mois</button>
        {/if}
        {#if lock.canReopen}
          <button class="btn" type="button" disabled={busy} onclick={reopen}><RotateCcw />Réouvrir</button>
        {/if}
      </div>
    {/if}

    {#if !locked}
      <div class="tools">
        <div class="brush" role="group" aria-label="Pinceau">
          <span class="brush-label"><Brush />Pinceau</span>
          {#each STATUSES as s, i (s)}
            <button type="button" class="chip {s}" aria-pressed={brush === s} onclick={() => toggleBrush(s)}>
              <span class="sw {s}"></span>{LABEL[s]}<kbd>{i + 1}</kbd>
            </button>
          {/each}
          <button type="button" class="chip" aria-pressed={brush === 'erase'} onclick={() => toggleBrush('erase')}>
            <Eraser size={16} />Effacer<kbd>0</kbd>
          </button>
        </div>
        <div class="views" role="group" aria-label="Affichage">
          <button type="button" class="chip" aria-pressed={view === 'grid'} onclick={() => setView('grid')}>Grille</button>
          <button type="button" class="chip" aria-pressed={view === 'list'} onclick={() => setView('list')}>Liste</button>
        </div>
      </div>
      <p class="hint desktop">
        {brush
          ? 'Cliquez ou glissez sur les demi-journées pour appliquer le pinceau'
          : 'Cliquez sur une demi-journée pour choisir un statut, ou glissez pour en sélectionner plusieurs'}
      </p>
    {/if}

    <Calendar {ym} map={store.map} {locked} {brush} {view} onapply={apply} />

    {#if !locked}
      <div class="m-brush" role="group" aria-label="Pinceau">
        {#each STATUSES as s (s)}
          <button type="button" class="chip {s}" aria-pressed={brush === s} onclick={() => toggleBrush(s)}>{LABEL[s]}</button>
        {/each}
        <button type="button" class="chip erase" aria-pressed={brush === 'erase'} onclick={() => toggleBrush('erase')} aria-label="Effacer"><Eraser size={16} /></button>
      </div>
    {/if}
  {:else}
    <div class="loading" aria-busy="true"></div>
  {/if}
</div>

<style>
  .back { display: inline-flex; align-items: center; gap: var(--sp-1); color: var(--ink-2); text-decoration: none; font-size: 14px; }
  .back:hover { color: var(--ink); }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
  .actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .actions.mobile { display: none; }
  .summary { display: flex; flex-direction: column; gap: var(--sp-4); }
  .tally { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2) var(--sp-5); color: var(--ink-2); font-size: 14px; margin-top: var(--sp-1); }
  .tally strong { color: var(--ink); font-weight: 500; }
  .k { display: inline-flex; align-items: center; gap: var(--sp-2); }
  .tools { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
  .brush, .views { display: flex; align-items: center; gap: var(--sp-1); padding: var(--sp-1); background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-m); flex-wrap: wrap; }
  .brush-label { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--ink-3); font-size: 14px; padding: 0 var(--sp-2); }
  .chip {
    height: 32px; padding: 0 var(--sp-3); border-radius: var(--r-s); border: 0; background: transparent; display: inline-flex;
    align-items: center; gap: var(--sp-2); font-weight: 500; font-size: 14px; color: var(--ink-2);
    transition: background-color 0.15s var(--ease), color 0.15s var(--ease);
  }
  .chip:hover { background: var(--bg); }
  .chip[aria-pressed='true'] { background: var(--raised); color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--ink); }
  .chip.present[aria-pressed='true'] { background: var(--present-bg); color: var(--present); box-shadow: inset 0 0 0 1.5px var(--present); }
  .chip.absent[aria-pressed='true'] { background: var(--absent-bg); color: var(--absent); box-shadow: inset 0 0 0 1.5px var(--absent); }
  .chip.conge[aria-pressed='true'] { background: var(--conge-bg); color: var(--conge); box-shadow: inset 0 0 0 1.5px var(--conge); }
  .chip.rtt[aria-pressed='true'] { background: var(--rtt-bg); color: var(--rtt); box-shadow: inset 0 0 0 1.5px var(--rtt); }
  .chip[aria-pressed='true'] kbd { border-color: currentColor; color: inherit; }
  .views .chip[aria-pressed='true'] { box-shadow: none; }
  .hint.desktop { margin-top: calc(-1 * var(--sp-3)); }
  .m-brush { display: none; }
  .loading { min-height: 50vh; }

  .stale { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4); border-color: rgba(168, 38, 28, 0.35); color: var(--danger); }
  .stale p { flex: 1; }

  @media (max-width: 899px) {
    .page.planning { padding-bottom: 72px; }
    .actions.desktop, .tools, .hint.desktop { display: none; }
    .actions.mobile { display: flex; }
    .actions.mobile .btn { flex: 1 1 0; min-width: 0; }
    .tally { gap: var(--sp-1) var(--sp-4); font-size: 13px; }
    .m-brush {
      position: fixed; left: 0; right: 0; bottom: 64px; z-index: 15; background: var(--paper); border-top: 1px solid var(--line);
      display: flex; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3);
    }
    .m-brush .chip { height: 44px; flex: 1 1 auto; white-space: nowrap; padding: 0 var(--sp-2); justify-content: center; border: 1px solid var(--line); font-size: 13px; }
    .m-brush .chip.erase { flex: 0 0 44px; }
    .m-brush .chip.present:not([aria-pressed='true']) { box-shadow: inset 0 -3px 0 var(--present-bar); }
    .m-brush .chip.absent:not([aria-pressed='true']) { box-shadow: inset 0 -3px 0 var(--absent-bar); }
    .m-brush .chip.conge:not([aria-pressed='true']) { box-shadow: inset 0 -3px 0 var(--conge-bar); }
    .m-brush .chip.rtt:not([aria-pressed='true']) { box-shadow: inset 0 -3px 0 var(--rtt-bar); }
  }
</style>
