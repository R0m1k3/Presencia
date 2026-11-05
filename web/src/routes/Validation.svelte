<script lang="ts">
  import { writes } from '../lib/queue.svelte.ts';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import FileText from '@lucide/svelte/icons/file-text';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import StackBar from '../components/StackBar.svelte';
  import { api, download, message } from '../lib/api.ts';
  import { confirm } from '../lib/confirm.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { badge } from '../lib/badge.svelte.ts';
  import { ok, error } from '../lib/toast.svelte.ts';
  import { currentYm, formatStamp, lastMonths, monthName, monthTitle, ymKey, type YearMonth } from '../lib/logic/dates.ts';
  import { workHalves } from '../lib/logic/totals.ts';
  import type { Company, CompanyMonth, Overview } from '../lib/types.ts';

  let { ym, companyId }: { ym: YearMonth; companyId: number | null } = $props();

  let companies = $state<Company[] | null>(null);
  let data = $state<CompanyMonth | null>(null);
  let err = $state('');
  let busy = $state(false);
  let exporting = $state<'excel' | 'pdf' | null>(null);
  const months = lastMonths(currentYm(), 12);
  const total = $derived(workHalves(ym));
  const company = $derived(companies?.find((c) => c.id === companyId) ?? null);
  const validatedCount = $derived(data?.cadres.filter((c) => c.cadreValidated).length ?? 0);

  async function init() {
    try {
      const list = await api<Company[]>('/companies');
      companies = list;
      if (companyId === null || !list.some((c) => c.id === companyId)) {
        if (list.length === 0) return;
        // The first company ready to validate, else the first one.
        const o = await api<Overview>(`/validations/overview?year=${ym.year}&month=${ym.month}`).catch(() => null);
        const ready = o?.companies.find((c) => !c.companyValidated && c.activeCadres > 0 && c.validatedCadres === c.activeCadres);
        go(`/validation/${ymKey(ym)}/${(ready ?? list[0]).id}`, true);
        return;
      }
      await load();
    } catch (e) {
      err = message(e);
    }
  }

  async function load() {
    err = '';
    // Planning writes still queued go first, so the figures include them.
    await writes.idle();
    try {
      data = await api<CompanyMonth>(`/validations/company/${companyId}?year=${ym.year}&month=${ym.month}`);
    } catch (e) {
      err = message(e);
    }
  }
  void init();

  function pickCompany(e: Event) {
    go(`/validation/${ymKey(ym)}/${(e.target as HTMLSelectElement).value}`);
  }
  function pickMonth(e: Event) {
    go(`/validation/${(e.target as HTMLSelectElement).value}/${companyId}`);
  }

  async function validateCompany() {
    if (!data || !company) return;
    const reopen = data.companyValidated;
    const mark = writes.mark();
    const yes = reopen
      ? await confirm('Réouvrir la société', `Les plannings de ${company.name} pour ${monthName(ym)} ${ym.year} redeviennent modifiables.`, 'Réouvrir')
      : await confirm('Valider la société', `Les plannings de ${company.name} pour ${monthName(ym)} ${ym.year} seront verrouillés pour tous, administrateur compris.`, 'Valider la société');
    if (!yes) return;
    busy = true;
    try {
      // A correction made just before must reach the server first; if it
      // failed, stop (the failure was already shown).
      if (!(await writes.settled(mark))) return;
      await api(`/validations/company/${companyId}${reopen ? '/reopen' : ''}`, 'POST', { year: ym.year, month: ym.month });
      ok(reopen ? 'Société réouverte' : 'Société validée');
      badge.refresh();
    } catch (e) {
      error(message(e));
    } finally {
      busy = false;
      await load();
    }
  }

  async function reopenCadre(id: number, name: string) {
    if (!(await confirm('Réouvrir le mois', `${name} pourra de nouveau modifier ${monthName(ym)} ${ym.year}.`, 'Réouvrir'))) return;
    try {
      await api('/validations/cadre/reopen', 'POST', { user_id: id, year: ym.year, month: ym.month });
      ok('Mois réouvert pour ce cadre');
    } catch (e) {
      error(message(e));
    }
    await load();
  }

  async function exportFile(kind: 'excel' | 'pdf') {
    exporting = kind;
    try {
      await writes.idle();
      await download(`/export/${kind}/${companyId}?year=${ym.year}&month=${ym.month}`, `presences.${kind === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch (e) {
      error(message(e));
    } finally {
      exporting = null;
    }
  }
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1 class="page-title">Validation et export</h1>
      <p class="page-sub">Une société se valide quand tous ses cadres actifs ont validé leur mois</p>
    </div>
    {#if companies && companies.length}
      <div class="row">
        <label class="field"><span class="visually-hidden">Société</span>
          <select class="input" value={String(companyId)} onchange={pickCompany}>
            {#each companies as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
          </select>
        </label>
        <label class="field"><span class="visually-hidden">Mois</span>
          <select class="input" value={ymKey(ym)} onchange={pickMonth}>
            {#if !months.some((m) => ymKey(m) === ymKey(ym))}<option value={ymKey(ym)}>{monthTitle(ym)}</option>{/if}
            {#each months as m (ymKey(m))}<option value={ymKey(m)}>{monthTitle(m)}</option>{/each}
          </select>
        </label>
      </div>
    {/if}
  </header>

  {#if err}
    <div class="panel empty" role="alert"><p>{err}</p><button class="btn" type="button" onclick={init}>Réessayer</button></div>
  {:else if companies && companies.length === 0}
    <p class="panel empty">Aucune société. Créez-en une dans <a href="#/societes">Sociétés</a>.</p>
  {:else if data && company}
    <section class="panel status">
      <div class="status-text">
        <h2 class="section-title">{company.name}, {monthName(ym)} {ym.year}</h2>
        <p class="secondary">
          {#if data.companyValidated}
            Validée{data.companyValidatedAt ? ` le ${formatStamp(data.companyValidatedAt)}` : ''} : plannings verrouillés
          {:else if data.cadres.length === 0}
            Aucun cadre actif dans cette société
          {:else}
            {validatedCount} cadre{validatedCount > 1 ? 's' : ''} sur {data.cadres.length} {validatedCount > 1 ? 'ont' : 'a'} validé leur mois
          {/if}
        </p>
        <span class="progress"><StackBar filled={validatedCount} total={Math.max(data.cadres.length, 1)} /></span>
      </div>
      <div class="row">
        <button class="btn" type="button" disabled={exporting !== null} onclick={() => exportFile('excel')}><FileSpreadsheet />Excel</button>
        <button class="btn" type="button" disabled={exporting !== null} onclick={() => exportFile('pdf')}><FileText />PDF</button>
        {#if data.companyValidated}
          <button class="btn" type="button" disabled={busy} onclick={validateCompany}><RotateCcw />Réouvrir la société</button>
        {:else}
          <button
            class="btn primary"
            type="button"
            disabled={busy || !data.allCadresValidated || data.cadres.length === 0}
            title={data.allCadresValidated ? undefined : 'Tous les cadres doivent d’abord valider leur mois'}
            onclick={validateCompany}
          ><CircleCheck />Valider la société</button>
        {/if}
      </div>
    </section>

    {#if data.cadres.length}
      <div class="panel">
        <table class="table cards">
          <thead><tr><th>Cadre</th><th>Renseigné</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {#each data.cadres as c (c.id)}
              <tr>
                <td><span class="cell-main">{c.fullName}</span><br /><span class="cell-sub">{c.email}</span></td>
                <td class="fill"><StackBar filled={c.filled} {total} /><span class="cell-sub">{c.filled}/{total}</span></td>
                <td>
                  <span class="tag" class:done={c.cadreValidated}>
                    {c.cadreValidated ? `Validé${c.cadreValidatedAt ? ` le ${formatStamp(c.cadreValidatedAt).split(' à ')[0]}` : ''}` : 'En saisie'}
                  </span>
                </td>
                <td class="actions">
                  <a class="btn small" href="#/plannings/{c.id}/{ymKey(ym)}">Voir</a>
                  {#if c.cadreValidated && !data.companyValidated}
                    <button class="btn small" type="button" onclick={() => reopenCadre(c.id, c.fullName)}>Réouvrir</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .status { padding: var(--sp-5); display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
  .status-text { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 240px; flex: 1; }
  .progress { max-width: 360px; }
  .fill { min-width: 160px; }
  .fill :global(.bar) { display: inline-flex; width: 120px; vertical-align: middle; margin-right: var(--sp-2); }
  .field { min-width: 180px; }
  @media (max-width: 899px) {
    .page-head .row { width: 100%; display: grid; grid-template-columns: 1fr 1fr; }
    .field { min-width: 0; }
  }
</style>
