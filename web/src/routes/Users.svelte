<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Dialog from '../components/Dialog.svelte';
  import CompanyFilter, { storedCompany } from '../components/CompanyFilter.svelte';
  import { search } from '../lib/logic/people.ts';
  import { api, message } from '../lib/api.ts';
  import { confirm } from '../lib/confirm.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { ok, error } from '../lib/toast.svelte.ts';
  import type { Company, Role, UserRow } from '../lib/types.ts';

  let companies = $state<Company[]>([]);
  let company = $state(storedCompany());
  let query = $state('');
  let list = $state<UserRow[] | null>(null);
  let err = $state('');

  // Form
  let editing = $state<UserRow | 'new' | null>(null);
  let fName = $state('');
  let fEmail = $state('');
  let fPassword = $state('');
  let fRole = $state<Role>('cadre');
  let fCompany = $state('');
  let formErr = $state('');
  let busy = $state(false);
  // Password reset
  let resetFor = $state<UserRow | null>(null);
  let rPassword = $state('');

  let companiesLoaded = $state(false);
  api<Company[]>('/companies')
    .then((c) => {
      companies = c;
      companiesLoaded = true;
    })
    .catch(() => {});

  let req = 0;
  async function load(filter: string) {
    const mine = ++req;
    err = '';
    try {
      const rows = await api<UserRow[]>(`/users${filter !== 'all' ? `?company_id=${filter}` : ''}`);
      if (mine === req) list = rows;
    } catch (e) {
      if (mine === req) err = message(e);
    }
  }
  $effect(() => {
    void load(company);
  });

  const shown = $derived(search(list ?? [], query));


  function open(u: UserRow | 'new') {
    editing = u;
    formErr = '';
    fPassword = '';
    if (u === 'new') {
      fName = '';
      fEmail = '';
      fRole = 'cadre';
      fCompany = company !== 'all' ? company : String(companies[0]?.id ?? '');
    } else {
      fName = u.full_name;
      fEmail = u.email;
      fRole = u.role;
      fCompany = u.company_id === null ? String(companies[0]?.id ?? '') : String(u.company_id);
    }
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!editing) return;
    busy = true;
    formErr = '';
    const body: Record<string, unknown> = {
      full_name: fName.trim(),
      email: fEmail.trim(),
      role: fRole,
      company_id: fRole === 'admin' ? null : fCompany,
    };
    try {
      if (editing === 'new') {
        await api('/users', 'POST', { ...body, password: fPassword });
        // A leftover filter would hide the account just created.
        company = 'all';
        query = '';
      } else {
        await api(`/users/${editing.id}`, 'PUT', { ...body, active: editing.active });
      }
      ok('Utilisateur enregistré');
      editing = null;
      await load(company);
    } catch (e) {
      formErr = message(e);
    } finally {
      busy = false;
    }
  }

  /** The account being activated or deactivated. */
  let toggling = $state<number | null>(null);
  async function toggle(u: UserRow) {
    if (u.active && !(await confirm('Désactiver le compte', `${u.full_name} ne pourra plus se connecter.`, 'Désactiver', true))) return;
    toggling = u.id;
    try {
      await api(`/users/${u.id}`, 'PUT', {
        full_name: u.full_name, email: u.email, role: u.role, company_id: u.company_id, active: !u.active,
      });
      ok(u.active ? `Compte désactivé : ${u.full_name}` : `Compte activé : ${u.full_name}`);
    } catch (e) {
      error(message(e));
    } finally {
      await load(company);
      toggling = null;
    }
  }

  async function resetPassword(e: SubmitEvent) {
    e.preventDefault();
    if (!resetFor) return;
    busy = true;
    formErr = '';
    try {
      await api(`/users/${resetFor.id}/password`, 'PUT', { password: rPassword });
      ok(`Mot de passe changé pour ${resetFor.full_name}`);
      resetFor = null;
    } catch (e) {
      formErr = message(e);
    } finally {
      busy = false;
    }
  }

  const self = (u: UserRow) => u.id === session.user?.id;
</script>

<div class="page">
  <header class="page-head">
    <div>
      <h1 class="page-title">Utilisateurs</h1>
      <p class="page-sub">{list ? `${shown.length} compte${shown.length > 1 ? 's' : ''}` : ' '}</p>
    </div>
    <div class="row">
      <CompanyFilter {companies} loaded={companiesLoaded} bind:company bind:query />
      <button class="btn primary" type="button" onclick={() => open('new')}><Plus />Nouvel utilisateur</button>
    </div>
  </header>

  {#if err}
    <div class="panel empty" role="alert"><p>{err}</p><button class="btn" type="button" onclick={() => load(company)}>Réessayer</button></div>
  {:else if list}
    <div class="panel">
      {#if shown.length === 0}
        <p class="empty">{list.length ? 'Aucun compte ne correspond à cette recherche' : 'Aucun compte'}</p>
      {:else}
        <table class="table cards">
          <thead><tr><th>Nom</th><th>Rôle</th><th>Société</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {#each shown as u (u.id)}
              <tr>
                <td><span class="cell-main">{u.full_name}</span><br /><span class="cell-sub">{u.email}</span></td>
                <td data-label="Rôle">{u.role === 'admin' ? 'Administrateur' : 'Cadre'}</td>
                <td data-label="Société">{u.company_name ?? '—'}</td>
                <td><span class="tag" class:off={!u.active}>{u.active ? 'Actif' : 'Inactif'}</span></td>
                <td class="actions">
                  <button class="btn small" type="button" onclick={() => open(u)}>Modifier</button>
                  <button class="btn small" type="button" onclick={() => { resetFor = u; rPassword = ''; formErr = ''; }}>Mot de passe</button>
                  {#if !self(u)}
                    <button class="btn small" class:danger={u.active} type="button" disabled={toggling === u.id} onclick={() => toggle(u)}>{u.active ? 'Désactiver' : 'Activer'}</button>
                  {/if}
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
  <Dialog title={editing === 'new' ? 'Nouvel utilisateur' : 'Modifier l’utilisateur'} onclose={() => (editing = null)}>
    <form id="user-form" class="form" onsubmit={save}>
      <label class="field"><span>Nom complet</span><input class="input" required bind:value={fName} /></label>
      <label class="field"><span>E-mail</span><input class="input" type="email" required bind:value={fEmail} /></label>
      {#if editing === 'new'}
        <label class="field"><span>Mot de passe</span>
          <input class="input" type="password" required minlength="8" autocomplete="new-password" bind:value={fPassword} />
          <span class="hint">8 caractères au moins, à transmettre à la personne</span>
        </label>
      {/if}
      <label class="field"><span>Rôle</span>
        <select class="input" bind:value={fRole} disabled={editing !== 'new' && self(editing)}>
          <option value="cadre">Cadre</option>
          <option value="admin">Administrateur</option>
        </select>
      </label>
      {#if fRole === 'cadre'}
        <label class="field"><span>Société</span>
          <select class="input" required bind:value={fCompany}>
            {#if companies.length === 0}<option value="">Aucune société : créez-en une d’abord</option>{/if}
            {#each companies as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
          </select>
        </label>
      {/if}
      {#if formErr}<p class="form-error" role="alert">{formErr}</p>{/if}
    </form>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (editing = null)}>Annuler</button>
      <button class="btn primary" type="submit" form="user-form" disabled={busy}>{editing === 'new' ? 'Créer' : 'Enregistrer'}</button>
    {/snippet}
  </Dialog>
{/if}

{#if resetFor}
  <Dialog title="Nouveau mot de passe" onclose={() => (resetFor = null)}>
    <form id="reset-form" class="form" onsubmit={resetPassword}>
      <p class="secondary">Pour {resetFor.full_name}. Transmettez-le à la personne, qui pourra le changer ensuite.</p>
      <label class="field"><span>Mot de passe</span>
        <input class="input" type="password" required minlength="8" autocomplete="new-password" bind:value={rPassword} />
      </label>
      <p class="hint">8 caractères au moins. Ses sessions ouvertes seront déconnectées.</p>
      {#if formErr}<p class="form-error" role="alert">{formErr}</p>{/if}
    </form>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (resetFor = null)}>Annuler</button>
      <button class="btn primary" type="submit" form="reset-form" disabled={busy}>Changer le mot de passe</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .form { display: flex; flex-direction: column; gap: var(--sp-4); }
</style>
