<script lang="ts">
  import { writes } from '../lib/queue.svelte.ts';
  import MonthNav from '../components/MonthNav.svelte';
  import StackBar from '../components/StackBar.svelte';
  import CompanyFilter, { storedCompany } from '../components/CompanyFilter.svelte';
  import { filledText, search } from '../lib/logic/people.ts';
  import { api, message } from '../lib/api.ts';
  import { ymKey, type YearMonth } from '../lib/logic/dates.ts';
  import { workHalves } from '../lib/logic/totals.ts';
  import type { Company, CompanyMonth, UserRow } from '../lib/types.ts';

  let { ym }: { ym: YearMonth } = $props();

  let companies = $state<Company[]>([]);
  let company = $state(storedCompany());
  let query = $state('');
  let cadres = $state<UserRow[] | null>(null);
  let month = $state(new Map<number, CompanyMonth['cadres'][number]>());
  let err = $state('');
  /** Some companies' figures could not be loaded. */
  let partial = $state(false);
  const total = $derived(workHalves(ym));

  api<Company[]>('/companies').then((c) => (companies = c)).catch(() => {});

  let req = 0;
  async function load(filter: string) {
    const mine = ++req;
    err = '';
    // Planning writes still queued go first, so the figures include them.
    await writes.idle();
    try {
      const qs = filter !== 'all' ? `?company_id=${filter}` : '';
      const list = (await api<UserRow[]>(`/users${qs}`)).filter((u) => u.role === 'cadre');
      const ids = [...new Set(list.map((u) => u.company_id).filter((id): id is number => id !== null))];
      const byId = new Map<number, CompanyMonth['cadres'][number]>();
      let failed = 0;
      // One company that fails (deleted meanwhile, server error) leaves the
      // others on screen, as the old screen did.
      await Promise.all(
        ids.map((cid) =>
          api<CompanyMonth>(`/validations/company/${cid}?year=${ym.year}&month=${ym.month}`)
            .then((v) => v.cadres.forEach((c) => byId.set(c.id, c)))
            .catch(() => failed++),
        ),
      );
      if (mine !== req) return;
      cadres = list;
      month = byId;
      partial = failed > 0;
    } catch (e) {
      if (mine === req) err = message(e);
    }
  }

  $effect(() => {
    void load(company);
  });

  const shown = $derived(search(cadres ?? [], query));

</script>

<div class="page">
  <header class="page-head">
    <div>
      <MonthNav {ym} href={(m) => `#/plannings/${ymKey(m)}`} />
      <p class="page-sub">Consultez ou corrigez le planning d’un cadre</p>
    </div>
    <CompanyFilter {companies} bind:company bind:query />
  </header>

  {#if err}
    <div class="panel empty" role="alert"><p>{err}</p><button class="btn" type="button" onclick={() => load(company)}>Réessayer</button></div>
  {:else if cadres}
    {#if partial}
      <p class="partial" role="status">Les chiffres de certaines sociétés n’ont pas pu être chargés : leurs cadres affichent « — ». <button class="btn small" type="button" onclick={() => load(company)}>Réessayer</button></p>
    {/if}
    <div class="panel">
      {#if shown.length === 0}
        <p class="empty">
          {#if cadres.length}Aucun cadre ne correspond à cette recherche.{:else}Aucun cadre. Créez des comptes « Cadre » dans <a href="#/utilisateurs">Utilisateurs</a>.{/if}
        </p>
      {:else}
        <table class="table cards">
          <thead><tr><th>Cadre</th><th>Société</th><th>Renseigné</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {#each shown as u (u.id)}
              {@const m = month.get(u.id)}
              <tr>
                <td><span class="cell-main">{u.full_name}</span><br /><span class="cell-sub">{u.email}</span></td>
                <td data-label="Société">{u.company_name ?? '—'}</td>
                <td class="fill">
                  {#if m}
                    <StackBar filled={m.filled} {total} />
                    <span class="cell-sub">{filledText(m.filled, total)}</span>
                  {:else}
                    <span class="cell-sub">—</span>
                  {/if}
                </td>
                <td>
                  <span class="tag" class:off={!u.active} class:done={u.active && m?.cadreValidated}>
                    {!u.active ? 'Inactif' : !m ? '—' : m.cadreValidated ? 'Validé' : 'En saisie'}
                  </span>
                </td>
                <td class="actions"><a class="btn small" href="#/plannings/{u.id}/{ymKey(ym)}">Ouvrir</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  .partial { display: flex; align-items: center; gap: var(--sp-3); color: var(--ink-2); font-size: 14px; }
  .fill { min-width: 160px; }
  .fill :global(.bar) { display: inline-flex; width: 120px; vertical-align: middle; margin-right: var(--sp-2); }
</style>
