<script lang="ts">
  // Share of each status in a month (or a plain progress when only a count
  // is known), drawn as one bar.
  import { days, segments } from '../lib/logic/totals.ts';
  import { LABEL, STATUSES, type Status } from '../lib/logic/status.ts';

  let {
    counts,
    filled,
    total,
    label,
  }: { counts?: Record<Status, number>; filled?: number; total: number; /** Spoken text, when the bar does not count half-days. */ label?: string } = $props();

  const parts = $derived(
    counts
      ? segments(counts, total)
      : [
          { key: 'fill' as const, share: Math.min(1, (filled ?? 0) / Math.max(total, 1)) },
          { key: 'empty' as const, share: Math.max(0, 1 - (filled ?? 0) / Math.max(total, 1)) },
        ],
  );
  const text = $derived(
    label ??
    (counts
      ? STATUSES.filter((s) => counts[s] > 0).map((s) => `${LABEL[s]} ${days(counts[s])} j`).join(', ') || 'Rien de renseigné'
      : `${filled ?? 0} demi-journées sur ${total}`),
  );
</script>

<span class="bar" role="img" aria-label={text}>
  {#each parts as p, i (i)}<i class={p.key === "empty" ? "rest" : p.key} style:width="{p.share * 100}%"></i>{/each}
</span>
