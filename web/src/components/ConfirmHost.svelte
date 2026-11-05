<script lang="ts">
  import Dialog from './Dialog.svelte';
  import { confirmState } from '../lib/confirm.svelte.ts';

  function answer(yes: boolean) {
    const c = confirmState.current;
    confirmState.current = null;
    c?.resolve(yes);
  }
</script>

{#if confirmState.current}
  {@const c = confirmState.current}
  <Dialog title={c.title} onclose={() => answer(false)}>
    <p class="secondary">{c.text}</p>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => answer(false)}>Annuler</button>
      <button class="btn primary" class:danger-fill={c.danger} type="button" onclick={() => answer(true)}>{c.ok}</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .danger-fill { background: var(--danger); border-color: var(--danger); }
  .danger-fill:hover { background: #8f1f17 !important; }
</style>
