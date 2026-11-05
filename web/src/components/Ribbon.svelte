<script lang="ts">
  // The month at a glance: two marks a day (morning, afternoon), weekends
  // dimmed, a dot under today.
  import { currentYm, daysInMonth, isoDate, isWeekend, type YearMonth } from '../lib/logic/dates.ts';
  import { halfKey, type HalfKey } from '../lib/logic/grid.ts';
  import type { Status } from '../lib/logic/status.ts';

  let { ym, map }: { ym: YearMonth; map: Map<HalfKey, Status> } = $props();
  const now = currentYm();
  const today = $derived(now.year === ym.year && now.month === ym.month ? new Date().getDate() : 0);
  const days = $derived(Array.from({ length: daysInMonth(ym) }, (_, i) => i + 1));
</script>

<div class="ribbon" style:grid-template-columns="repeat({days.length}, 1fr)" aria-hidden="true">
  {#each days as d (d)}
    {@const date = isoDate(ym, d)}
    <span class="d" class:we={isWeekend(ym, d)} class:today={d === today}>
      <i class={map.get(halfKey(date, 'AM')) ?? ''}></i>
      <i class={map.get(halfKey(date, 'PM')) ?? ''}></i>
    </span>
  {/each}
</div>

<style>
  .ribbon { display: grid; gap: 4px; height: 28px; }
  .d { display: grid; grid-template-rows: 1fr 1fr; gap: 2px; position: relative; }
  .d i { border-radius: 2px; background: var(--empty-bar); transition: background-color 0.15s var(--ease); }
  .d.we { opacity: 0.45; }
  .d.today::after {
    content: ''; position: absolute; left: 50%; bottom: -12px; width: 4px; height: 4px; margin-left: -2px;
    border-radius: 50%; background: var(--ink);
  }
  .present { background: var(--present-bar) !important; }
  .absent { background: var(--absent-bar) !important; }
  .conge { background: var(--conge-bar) !important; }
  .rtt { background: var(--rtt-bar) !important; }
  @media (max-width: 899px) { .ribbon { height: 22px; gap: 2px; } }
</style>
