<script lang="ts">
  import StackBar from '../components/StackBar.svelte';
  import { api, message } from '../lib/api.ts';
  import { monthTitle, ymKey } from '../lib/logic/dates.ts';
  import { days, workHalves } from '../lib/logic/totals.ts';
  import type { HistoryRow } from '../lib/types.ts';

  let rows = $state<HistoryRow[] | null>(null);
  let err = $state('');

  async function load() {
    err = '';
    try {
      rows = await api<HistoryRow[]>('/attendance/history');
    } catch (e) {
      err = message(e);
    }
  }
  void load();
</script>

<div class="page">
  <header>
    <h1 class="page-title">Historique</h1>
    <p class="page-sub">Vos mois saisis, du plus récent au plus ancien</p>
  </header>

  {#if err}
    <div class="panel empty" role="alert"><p>{err}</p><button class="btn" type="button" onclick={load}>Réessayer</button></div>
  {:else if rows}
    <div class="panel">
      {#if rows.length === 0}
        <p class="empty">Aucun mois saisi pour l’instant. Commencez par <a href="#/planning/{ymKey({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 })}">votre planning</a>.</p>
      {:else}
        <table class="table cards">
          <thead><tr><th>Mois</th><th>Répartition</th><th class="num">Présent</th><th class="num">Non-présent</th><th class="num">Congé</th><th class="num">RTT</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {#each rows as r (`${r.year}-${r.month}`)}
              {@const ym = { year: r.year, month: r.month }}
              <tr>
                <td class="cell-main">{monthTitle(ym)}</td>
                <td class="bar-cell"><StackBar counts={r} total={workHalves(ym)} /></td>
                <td class="num" data-label="Présent">{days(r.present)} j</td>
                <td class="num" data-label="Non-présent">{days(r.absent)} j</td>
                <td class="num" data-label="Congé">{days(r.conge)} j</td>
                <td class="num" data-label="RTT">{days(r.rtt)} j</td>
                <td>
                  <span class="tag" class:done={r.companyValidated} class:wait={!r.companyValidated && r.cadreValidated}>
                    {r.companyValidated ? 'Validé' : r.cadreValidated ? 'Transmis' : 'En saisie'}
                  </span>
                </td>
                <td class="actions"><a class="btn small" href="#/planning/{ymKey(ym)}">Ouvrir</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  .bar-cell { width: 28%; min-width: 120px; }
</style>
