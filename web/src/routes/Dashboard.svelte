<script lang="ts">
  import { writes } from '../lib/queue.svelte.ts';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import History from '@lucide/svelte/icons/history';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ribbon from '../components/Ribbon.svelte';
  import { api, message } from '../lib/api.ts';
  import { session } from '../lib/session.svelte.ts';
  import { currentYm, monthName, monthTitle, ymKey } from '../lib/logic/dates.ts';
  import { emptyWorkHalves, toMap } from '../lib/logic/grid.ts';
  import { countHalves, days, percent, workHalves } from '../lib/logic/totals.ts';
  import { isReady } from '../lib/logic/people.ts';
  import type { Overview, Planning } from '../lib/types.ts';

  const ym = currentYm();
  const key = ymKey(ym);
  const total = workHalves(ym);
  let mine = $state<Planning | null>(null);
  let overview = $state<Overview | null>(null);
  let err = $state('');
  let overviewErr = $state('');

  const map = $derived(mine ? toMap(mine.entries) : new Map());
  const counts = $derived(countHalves(map.values()));
  // Workdays only, like `total`: a weekend entry does not count towards it.
  const filled = $derived(total - emptyWorkHalves(ym, map).length);
  const validated = $derived(!!mine && (mine.cadreValidated || mine.companyValidated));

  async function load() {
    err = '';
    // Planning writes still queued go first, so the figures include them.
    await writes.idle();
    try {
      const qs = `year=${ym.year}&month=${ym.month}`;
      const [p, o] = await Promise.all([
        api<Planning>(`/attendance?${qs}`),
        // A failing overview must not hide the admin's own figures.
        session.isAdmin ? api<Overview>(`/validations/overview?${qs}`).catch((e) => ((overviewErr = message(e)), null)) : Promise.resolve(null),
      ]);
      mine = p;
      overview = o;
      if (o) overviewErr = '';
    } catch (e) {
      err = message(e);
    }
  }
  void load();

  const ready = $derived(
    overview?.companies.filter(isReady) ?? [],
  );
  const late = $derived(overview?.companies.filter((c) => !c.companyValidated && c.validatedCadres < c.activeCadres) ?? []);
</script>

<div class="page">
  <header>
    <h1 class="page-title">{monthTitle(ym)}</h1>
    <p class="page-sub">
      {#if session.isAdmin && overview}
        {overview.companies.length} société{overview.companies.length > 1 ? 's' : ''}, {overview.totalActiveCadres} cadre{overview.totalActiveCadres > 1 ? 's' : ''} actif{overview.totalActiveCadres > 1 ? 's' : ''}
      {:else if mine}
        Votre mois de {monthName(ym)} est renseigné à {percent(filled, total)} %
      {/if}
    </p>
  </header>

  {#if err}
    <div class="panel empty" role="alert"><p>{err}</p><button class="btn" type="button" onclick={load}>Réessayer</button></div>
  {:else if mine}
    {#if session.isAdmin && !overview}
      <div class="panel empty" role="alert"><p>Les chiffres des sociétés n’ont pas pu être chargés. {overviewErr}</p><button class="btn" type="button" onclick={load}>Réessayer</button></div>
    {/if}
    <div class="tiles">
      {#if session.isAdmin && overview}
        <div class="panel tile"><p class="tile-label">À valider</p><p class="tile-value">{overview.pendingCompanies}</p><p class="tile-hint">sociétés pas encore validées</p></div>
        <div class="panel tile"><p class="tile-label">Cadres en retard</p><p class="tile-value">{overview.lateCadres}</p><p class="tile-hint">mois non validé</p></div>
        <div class="panel tile"><p class="tile-label">Sociétés</p><p class="tile-value">{overview.companies.length}</p><p class="tile-hint">{overview.totalActiveCadres} cadres actifs</p></div>
        <div class="panel tile"><p class="tile-label">Ma saisie</p><p class="tile-value">{filled}/{total}</p><p class="tile-hint">demi-journées ouvrées</p></div>
      {:else}
        <div class="panel tile"><p class="tile-label">Renseigné</p><p class="tile-value">{filled}/{total}</p><p class="tile-hint">demi-journées ouvrées</p></div>
        <div class="panel tile"><p class="tile-label">Présent</p><p class="tile-value">{days(counts.present)} j</p><p class="tile-hint">sur le mois</p></div>
        <div class="panel tile"><p class="tile-label">Congé</p><p class="tile-value">{days(counts.conge)} j</p><p class="tile-hint">sur le mois</p></div>
        <div class="panel tile"><p class="tile-label">RTT</p><p class="tile-value">{days(counts.rtt)} j</p><p class="tile-hint">sur le mois</p></div>
      {/if}
    </div>

    <section class="panel month">
      <div class="row"><h2 class="section-title">Mon mois</h2><span class="spacer"></span><a class="btn small" href="#/planning/{key}">Ouvrir le planning</a></div>
      <Ribbon {ym} {map} />
    </section>

    <section class="panel">
      <h2 class="section-title pad">À faire</h2>
      <div class="shortcuts">
        {#if session.isAdmin}
          {#each ready.slice(0, 3) as c (c.id)}
            <a class="shortcut" href="#/validation/{key}/{c.id}">
              <span class="shortcut-icon"><CircleCheck /></span>
              <span class="grow"><span class="cell-main">{c.name} est prête à valider</span><br /><span class="cell-sub">{c.activeCadres > 1 ? `Les ${c.activeCadres} cadres actifs ont validé leur mois` : 'Le cadre actif a validé son mois'}</span></span>
              <ChevronRight />
            </a>
          {/each}
          {#each late.slice(0, 3) as c (c.id)}
            <a class="shortcut" href="#/validation/{key}/{c.id}">
              <span class="shortcut-icon"><ListChecks /></span>
              <span class="grow"><span class="cell-main">{c.name} : {c.activeCadres - c.validatedCadres} cadre{c.activeCadres - c.validatedCadres > 1 ? 's' : ''} en retard</span><br /><span class="cell-sub">{c.validatedCadres} sur {c.activeCadres} {c.validatedCadres > 1 ? 'ont validé leur' : 'a validé son'} mois</span></span>
              <ChevronRight />
            </a>
          {/each}
        {/if}
        <a class="shortcut" href="#/planning/{key}">
          <span class="shortcut-icon"><CalendarDays /></span>
          <span class="grow"><span class="cell-main">Compléter mon planning</span><br /><span class="cell-sub">{total - filled} demi-journées ouvrées à renseigner</span></span>
          <ChevronRight />
        </a>
        {#if !session.isAdmin}
          <a class="shortcut" href="#/planning/{key}">
            <span class="shortcut-icon"><CircleCheck /></span>
            <span class="grow"><span class="cell-main">{validated ? 'Mois transmis à l’administrateur' : 'Valider mon mois'}</span><br /><span class="cell-sub">{validated ? 'Vos saisies sont verrouillées' : 'À faire en fin de mois, une fois tout renseigné'}</span></span>
            <ChevronRight />
          </a>
          <a class="shortcut" href="#/historique">
            <span class="shortcut-icon"><History /></span>
            <span class="grow"><span class="cell-main">Historique</span><br /><span class="cell-sub">Vos mois précédents et leurs totaux</span></span>
            <ChevronRight />
          </a>
        {/if}
      </div>
    </section>

    {#if session.isAdmin && overview}
      <section class="panel">
        <h2 class="section-title pad">Sociétés</h2>
        {#if overview.companies.length === 0}
          <p class="empty">Aucune société. Créez-en une dans <a href="#/societes">Sociétés</a>.</p>
        {:else}
          <table class="table cards">
            <thead><tr><th>Société</th><th>Cadres validés</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {#each overview.companies as c (c.id)}
                <tr>
                  <td class="cell-main">{c.name}</td>
                  <td data-label="Cadres validés">{c.validatedCadres}/{c.activeCadres}</td>
                  <td>
                    <span class="tag" class:done={c.companyValidated} class:wait={isReady(c)}>
                      {c.companyValidated ? 'Validée' : isReady(c) ? 'Prête à valider' : 'En cours'}
                    </span>
                  </td>
                  <td class="actions"><a class="btn small" href="#/validation/{key}/{c.id}">Ouvrir</a></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .month { padding: var(--sp-4) var(--sp-5) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-4); }
  .pad { padding: var(--sp-4) var(--sp-4) var(--sp-2); }
  .shortcut :global(svg) { color: var(--ink-3); flex: none; }
</style>
