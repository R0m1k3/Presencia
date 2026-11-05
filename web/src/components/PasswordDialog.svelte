<script lang="ts">
  import Dialog from './Dialog.svelte';
  import { api, message } from '../lib/api.ts';
  import { ok } from '../lib/toast.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();
  let current = $state('');
  let password = $state('');
  let again = $state('');
  let err = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    err = '';
    if (password.length < 8) return void (err = 'Le nouveau mot de passe doit faire au moins 8 caractères.');
    if (password !== again) return void (err = 'Les deux saisies du nouveau mot de passe diffèrent.');
    busy = true;
    try {
      await api('/auth/password', 'PUT', { current, password });
      ok('Mot de passe changé');
      onclose();
    } catch (e) {
      err = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title="Mon mot de passe" {onclose}>
  <form id="pwd-form" class="form" onsubmit={submit}>
    <label class="field"><span>Mot de passe actuel</span>
      <input class="input" type="password" autocomplete="current-password" required bind:value={current} />
    </label>
    <label class="field"><span>Nouveau mot de passe</span>
      <input class="input" type="password" autocomplete="new-password" required minlength="8" bind:value={password} />
    </label>
    <label class="field"><span>Nouveau mot de passe, encore</span>
      <input class="input" type="password" autocomplete="new-password" required bind:value={again} />
    </label>
    <p class="hint">8 caractères au moins. Vos autres sessions seront déconnectées.</p>
    {#if err}<p class="form-error" role="alert">{err}</p>{/if}
  </form>
  {#snippet footer()}
    <button class="btn" type="button" onclick={onclose}>Annuler</button>
    <button class="btn primary" type="submit" form="pwd-form" disabled={busy}>Changer le mot de passe</button>
  {/snippet}
</Dialog>

<style>
  .form { display: flex; flex-direction: column; gap: var(--sp-4); }
</style>
