<script lang="ts">
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { toasts } from '../lib/toast.svelte.ts';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
      <span>{t.text}</span>
      {#if t.action}
        <button class="btn small" type="button" onclick={() => t.action?.run()}>
          <Undo2 size={16} />{t.action.label}<kbd class="kbd">Ctrl Z</kbd>
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed; right: 24px; bottom: 24px; z-index: 50; display: flex; flex-direction: column; gap: var(--sp-2);
    align-items: flex-end; pointer-events: none;
  }
  .toast {
    pointer-events: auto; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-m);
    box-shadow: var(--shadow-float); display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4); min-height: 48px; font-size: 14px; max-width: min(480px, calc(100vw - 24px));
  }
  .toast:not(:has(button)) { padding-right: var(--sp-4); }
  .toast.error { border-color: rgba(168, 38, 28, 0.35); color: var(--danger); }
  @media (max-width: 899px) {
    .toasts { left: 12px; right: 12px; bottom: 76px; align-items: stretch; }
    .toast { justify-content: space-between; }
    .kbd { display: none; }
  }
</style>
