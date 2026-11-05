<script lang="ts">
  import Lock from '@lucide/svelte/icons/lock';
  import { formatStamp } from '../lib/logic/dates.ts';
  import type { Banner } from '../lib/logic/lock.ts';
  import { session } from '../lib/session.svelte.ts';

  let { banner, cadreAt, companyAt }: { banner: Banner; cadreAt: string | null; companyAt: string | null } = $props();
</script>

{#if banner !== 'none'}
  <div class="banner" role="status">
    <Lock />
    <div>
      {#if banner === 'company'}
        <b>Mois validé par l’administrateur{companyAt ? ` le ${formatStamp(companyAt)}` : ''}</b>
        {#if session.isAdmin}
          <p>Les saisies sont verrouillées. Une correction demande de réouvrir la société dans Validation.</p>
        {:else}
          <p>Les saisies sont verrouillées. Pour une correction, adressez-vous à l’administrateur.</p>
        {/if}
      {:else if banner === 'cadre-own'}
        <b>Mois validé{cadreAt ? ` le ${formatStamp(cadreAt)}` : ''}, saisies verrouillées</b>
        <p>Un administrateur doit réouvrir le mois pour toute correction.</p>
      {:else if banner === 'cadre-own-editable'}
        <b>Mois validé{cadreAt ? ` le ${formatStamp(cadreAt)}` : ''}</b>
        <p>En tant qu’administrateur, vous pouvez encore corriger ce planning.</p>
      {:else}
        <b>Validé par le cadre{cadreAt ? ` le ${formatStamp(cadreAt)}` : ''}</b>
        <p>Vous pouvez encore corriger ce planning, ou réouvrir le mois pour que le cadre le reprenne.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .banner {
    display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-3) var(--sp-4);
    background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-m);
  }
  .banner :global(svg) { color: var(--ink-2); margin-top: 2px; flex: none; }
  b { font-weight: 500; }
  p { color: var(--ink-2); font-size: 14px; }
</style>
