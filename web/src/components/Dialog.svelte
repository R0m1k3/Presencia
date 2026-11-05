<script lang="ts">
  // Modal on a native <dialog>: focus moves in and comes back to the opener,
  // Escape and a click on the backdrop close it.
  import type { Snippet } from 'svelte';
  import X from '@lucide/svelte/icons/x';

  let {
    title,
    onclose,
    children,
    footer,
  }: { title: string; onclose: () => void; children: Snippet; footer?: Snippet } = $props();

  let dialog: HTMLDialogElement;
  const opener = document.activeElement as HTMLElement | null;

  $effect(() => {
    dialog.showModal();
    return () => opener?.focus?.();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="dialog-title"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
  onclick={(e) => {
    if (e.target === dialog) onclose();
  }}
>
  <div class="box">
    <header>
      <h2 id="dialog-title">{title}</h2>
      <button class="icon-btn ghost" type="button" aria-label="Fermer" onclick={onclose}><X /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  dialog {
    border: 0; padding: 0; border-radius: var(--r-m); width: min(440px, calc(100vw - 24px));
    box-shadow: 0 16px 48px rgba(17, 24, 39, 0.18); color: var(--ink);
  }
  dialog::backdrop { background: rgba(17, 24, 39, 0.32); }
  .box { padding: var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-4); }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
  h2 { font-size: 17px; font-weight: 500; }
  .ghost { border-color: transparent; }
  .body { display: flex; flex-direction: column; gap: var(--sp-4); }
  footer { display: flex; justify-content: flex-end; gap: var(--sp-2); flex-wrap: wrap; }
</style>
