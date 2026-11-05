<script lang="ts" module>
  const KEY = 'presencia.company';
  /** The company filter chosen earlier in this session, shared by Plannings and Utilisateurs. */
  export function storedCompany(): string {
    return sessionStorage.getItem(KEY) ?? 'all';
  }
  /** Forgets the stored filter if it points at `id` (a deleted company). */
  export function forgetCompany(id: number) {
    if (sessionStorage.getItem(KEY) === String(id)) sessionStorage.removeItem(KEY);
  }
</script>

<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import type { Company } from '../lib/types.ts';

  let {
    companies,
    company = $bindable('all'),
    query = $bindable(''),
  }: { companies: Company[]; company?: string; query?: string } = $props();

  $effect(() => {
    sessionStorage.setItem(KEY, company);
  });
  // A filter on a company that no longer exists would show an empty list.
  $effect(() => {
    if (companies.length && company !== 'all' && !companies.some((c) => String(c.id) === company)) company = 'all';
  });
</script>

<div class="filters">
  <label class="field">
    <span class="visually-hidden">Société</span>
    <select class="input" bind:value={company}>
      <option value="all">Toutes les sociétés</option>
      {#each companies as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
    </select>
  </label>
  <label class="field search">
    <span class="visually-hidden">Rechercher par nom ou e-mail</span>
    <Search />
    <input class="input" type="search" placeholder="Nom ou e-mail" bind:value={query} />
  </label>
</div>

<style>
  .filters { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .filters .field { width: 240px; }
  .search { position: relative; }
  .search :global(svg) { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-3); pointer-events: none; }
  .search .input { padding-left: 38px; }
  @media (max-width: 899px) { .filters .field { width: 100%; } }
</style>
