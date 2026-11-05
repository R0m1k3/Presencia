<script lang="ts">
  import { badge } from '../lib/badge.svelte.ts';
  import Plus from '@lucide/svelte/icons/plus';
  import Dialog from '../components/Dialog.svelte';
  import { api, message } from '../lib/api.ts';
  import { confirm } from '../lib/confirm.svelte.ts';
  import { ok, error } from '../lib/toast.svelte.ts';
  import { formatDay } from '../lib/logic/dates.ts';
  import type { Company } from '../lib/types.ts';

  let list = $state<Company[] | null>(null);
  let err = $state('');
  let editing = $state<Company | 'new' | null>(null);
  let name = $state('');
  let formErr = $state('');
  let busy = $state(false);

  async function load() {
    err = '';
    try {
      list = await api<Company[]>('/companies');
    } catch (e) {
      err = message(e);
    }
  }
  void load();

  function open(c: Company | 'new') {
    editing = c;
    name = c === 'new' ? '' : c.name;
    formErr = '';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!editing) return;
    busy = true;
    formErr = '';
    try {
      if (editing === 'new') await api('/companies', 'POST', { name: name.trim() });
      else await api(`/companies/${editing.id}`, 'PUT', { name: name.trim() });
      ok(editing === 'new' ? 'Société créée' : 'Société renommée');
      badge.refresh();
      editing = null;
      await load();
    } catch (e) {
      formErr = message(e);
    } finally {
      busy = false;
    }
  }

  /** The company whose deletion is being sent. */
  let removing = $state<number | null>(null);

  async function remove(c: Company) {
    const n = Number(c.active_cadre_count);
    const who = n ? `${n} cadre${n > 1 ? 's actifs' : ' actif'}, plus les inactifs` : 'Les cadres inactifs';
    const text =
      `${who} rattachés à ${c.name} n’auront plus de société, et ses validations mensuelles seront supprimées. ` +
      'Les saisies des cadres sont conservées.';
    if (!(await confirm(`Supprimer ${c.name}`, text, 'Supprimer', true))) return;
    removing = c.id;
    try {
      await api(`/companies/${c.id}`, 'DELETE');
      ok('Société supprimée');
      badge.refresh();
    } catch (e) {
      error(message(e));
    } finally {
      removing = null;
    }
    await load();
  }
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1 class="page-title">Sociétés</h1>
      <p class="page-sub">{list ? `${list.length} société${list.length > 1 ? 's' : ''}` : ' '}</p>
    </div>
    <button class="btn primary" type="button" onclick={() => open('new')}><Plus />Nouvelle société</button>
  </header>

  {#if err}
    <div class="panel empty" role="alert"><p>{err}</p><button class="btn" type="button" onclick={load}>Réessayer</button></div>
  {:else if list}
    <div class="panel">
      {#if list.length === 0}
        <p class="empty">Aucune société. Créez la première pour y rattacher des cadres</p>
      {:else}
        <table class="table cards">
          <thead><tr><th>Nom</th><th class="num">Cadres actifs</th><th>Créée le</th><th></th></tr></thead>
          <tbody>
            {#each list as c (c.id)}
              <tr>
                <td class="cell-main">{c.name}</td>
                <td class="num" data-label="Cadres actifs">{c.active_cadre_count}</td>
                <td data-label="Créée le">{formatDay(c.created_at)}</td>
                <td class="actions">
                  <button class="btn small" type="button" onclick={() => open(c)}>Renommer</button>
                  <button class="btn small danger" type="button" disabled={removing === c.id} onclick={() => remove(c)}>Supprimer</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

{#if editing}
  <Dialog title={editing === 'new' ? 'Nouvelle société' : 'Renommer la société'} onclose={() => (editing = null)}>
    <form id="co-form" class="form" onsubmit={save}>
      <label class="field"><span>Nom</span><input class="input" required maxlength="200" bind:value={name} /></label>
      {#if formErr}<p class="form-error" role="alert">{formErr}</p>{/if}
    </form>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (editing = null)}>Annuler</button>
      <button class="btn primary" type="submit" form="co-form" disabled={busy}>{editing === 'new' ? 'Créer' : 'Enregistrer'}</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .form { display: flex; flex-direction: column; gap: var(--sp-4); }
</style>
