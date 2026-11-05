<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { addMonths, monthName, type YearMonth } from '../lib/logic/dates.ts';

  let { ym, href, big = false }: { ym: YearMonth; href: (ym: YearMonth) => string; big?: boolean } = $props();
  const name = $derived(monthName(ym));
</script>

<div class="month" class:big>
  <h1><span class="name">{name[0].toUpperCase()}{name.slice(1)}</span> <span class="year">{ym.year}</span></h1>
  <a class="icon-btn" href={href(addMonths(ym, -1))} aria-label="Mois précédent"><ChevronLeft /></a>
  <a class="icon-btn" href={href(addMonths(ym, 1))} aria-label="Mois suivant"><ChevronRight /></a>
</div>

<style>
  .month { display: flex; align-items: center; gap: var(--sp-2); }
  h1 { margin-right: var(--sp-2); font-size: 28px; line-height: 1.15; font-weight: 500; letter-spacing: -0.01em; }
  .big h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; }
  .year { font-weight: 400; color: var(--ink-3); }
  @media (max-width: 899px) {
    .big h1 { font-size: 28px; }
    .month { gap: var(--sp-1); }
  }
</style>
