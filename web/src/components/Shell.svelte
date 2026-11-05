<script lang="ts">
  // App frame: sidebar on desktop, tab bar under 900 px; entries by role.
  import { badge } from '../lib/badge.svelte.ts';
  import type { Snippet } from 'svelte';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import History from '@lucide/svelte/icons/history';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import Users from '@lucide/svelte/icons/users';
  import Building from '@lucide/svelte/icons/building';
  import CalendarCheck from '@lucide/svelte/icons/calendar-check';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import LogOut from '@lucide/svelte/icons/log-out';
  import User from '@lucide/svelte/icons/user';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import PasswordDialog from './PasswordDialog.svelte';
  import Dialog from './Dialog.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { router, segments, go } from '../lib/router.svelte.ts';
  import { api } from '../lib/api.ts';
  import { pendingWrites, writes } from '../lib/queue.svelte.ts';
  import { ok as notify } from '../lib/toast.svelte.ts';
  import { currentYm, ymKey } from '../lib/logic/dates.ts';
  import type { Overview } from '../lib/types.ts';

  let { children }: { children: Snippet } = $props();

  type Item = { href: string; key: string; label: string; short: string; icon: typeof CalendarDays; badge?: number };
  const ym = ymKey(currentYm());
  let pending = $state(0);
  let showPassword = $state(false);
  let showMore = $state(false);

  const section = $derived(segments(router.path)[0] ?? '');

  const items = $derived<Item[]>(
    session.isAdmin
      ? [
          { href: '#/', key: '', label: 'Tableau de bord', short: 'Accueil', icon: LayoutDashboard },
          { href: `#/validation/${ym}`, key: 'validation', label: 'Validation', short: 'Validation', icon: ListChecks, badge: pending },
          { href: `#/plannings/${ym}`, key: 'plannings', label: 'Plannings', short: 'Plannings', icon: Users },
          { href: `#/planning/${ym}`, key: 'planning', label: 'Mon planning', short: 'Mon planning', icon: CalendarDays },
          { href: '#/utilisateurs', key: 'utilisateurs', label: 'Utilisateurs', short: 'Utilisateurs', icon: User },
          { href: '#/societes', key: 'societes', label: 'Sociétés', short: 'Sociétés', icon: Building },
        ]
      : [
          { href: '#/', key: '', label: 'Tableau de bord', short: 'Accueil', icon: LayoutDashboard },
          { href: `#/planning/${ym}`, key: 'planning', label: 'Mon planning', short: 'Planning', icon: CalendarDays },
          { href: '#/historique', key: 'historique', label: 'Historique', short: 'Historique', icon: History },
        ],
  );
  /** The tab bar keeps three destinations; the rest goes under « Plus » / « Compte ». */
  const tabs = $derived(items.slice(0, 3));
  const more = $derived(items.slice(3));

  // Companies waiting for the admin: on sign-in, then after each action
  // that can change the count (badge.refresh()).
  $effect(() => {
    void badge.version;
    if (!session.isAdmin) return;
    const now = currentYm();
    api<Overview>(`/validations/overview?year=${now.year}&month=${now.month}`)
      .then((o) => (pending = o.pendingCompanies))
      .catch(() => {});
  });

  let leaving = $state(false);
  async function logout() {
    if (leaving) return;
    leaving = true;
    showMore = false;
    // Writes still queued are sent first; say so, as it can take a moment.
    if (pendingWrites() > 0) notify('Enregistrement en cours, déconnexion juste après');
    await writes.idle();
    await api('/auth/logout', 'POST').catch(() => {});
    session.user = null;
    leaving = false;
    go('/connexion');
  }
</script>

<div class="shell">
  <aside class="side">
    <div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i></span>Presencia</div>
    <nav class="nav" aria-label="Navigation">
      {#each items as it (it.key)}
        <a href={it.href} aria-current={section === it.key ? 'page' : undefined}>
          <it.icon />{it.label}
          {#if it.badge}<span class="badge" aria-hidden="true">{it.badge}</span><span class="visually-hidden">, {it.badge} en attente</span>{/if}
        </a>
      {/each}
    </nav>
    <div class="foot">
      <div class="who">
        <b>{session.user?.fullName}</b>
        <span>{session.isAdmin ? 'Administrateur' : `Cadre${session.user?.companyName ? `, ${session.user.companyName}` : ''}`}</span>
      </div>
      <div class="nav">
        <button type="button" onclick={() => (showPassword = true)}><KeyRound />Mon mot de passe</button>
        <button type="button" disabled={leaving} onclick={logout}><LogOut />{leaving ? 'Déconnexion…' : 'Se déconnecter'}</button>
      </div>
    </div>
  </aside>

  <main id="main">{@render children()}</main>

  <nav class="tabbar" aria-label="Navigation">
    {#each tabs as it (it.key)}
      <a href={it.href} aria-current={section === it.key ? 'page' : undefined}>
        <span class="tab-icon"><it.icon />{#if it.badge}<span class="dot" aria-hidden="true"></span>{/if}</span>{it.short}{#if it.badge}<span class="visually-hidden">, {it.badge} en attente</span>{/if}
      </a>
    {/each}
    <button type="button" aria-current={more.some((m) => m.key === section) ? 'page' : undefined} onclick={() => (showMore = true)}>
      <span class="tab-icon">{#if session.isAdmin}<Ellipsis />{:else}<User />{/if}</span>{session.isAdmin ? 'Plus' : 'Compte'}
    </button>
  </nav>
</div>

{#if showMore}
  <Dialog title={session.isAdmin ? 'Plus' : 'Compte'} onclose={() => (showMore = false)}>
    <div class="sheet">
      <p class="secondary">{session.user?.fullName}</p>
      {#each more as it (it.key)}
        <a class="btn" href={it.href} onclick={() => (showMore = false)}><it.icon />{it.label}</a>
      {/each}
      <button class="btn" type="button" onclick={() => { showMore = false; showPassword = true; }}><KeyRound />Mon mot de passe</button>
      <button class="btn" type="button" onclick={logout}><LogOut />Se déconnecter</button>
    </div>
  </Dialog>
{/if}

{#if showPassword}<PasswordDialog onclose={() => (showPassword = false)} />{/if}

<style>
  .shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
  .side {
    background: var(--paper); border-right: 1px solid var(--line); padding: var(--sp-5) var(--sp-3);
    display: flex; flex-direction: column; gap: var(--sp-6); position: sticky; top: 0; height: 100vh;
  }
  .brand { display: flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-2); font-weight: 600; font-size: 17px; }
  .mark { width: 22px; height: 22px; display: grid; grid-template-rows: 1fr 1fr; gap: 2px; }
  .mark i:first-child { background: var(--present-bar); border-radius: 4px 4px 1px 1px; }
  .mark i:last-child { background: var(--ink); border-radius: 1px 1px 4px 4px; }
  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav a, .nav button {
    display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 var(--sp-3); border-radius: var(--r-s);
    color: var(--ink-2); text-decoration: none; font-weight: 500; border: 0; background: transparent; text-align: left; width: 100%;
    transition: background-color 0.15s var(--ease), color 0.15s var(--ease);
  }
  .nav :global(svg) { color: var(--ink-3); flex: none; }
  .nav a:hover, .nav button:hover { background: var(--bg); color: var(--ink); }
  .nav a[aria-current='page'] { background: var(--raised); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-soft); }
  .nav a[aria-current='page'] :global(svg) { color: var(--ink); }
  .nav .badge { margin-left: auto; }
  .foot { margin-top: auto; border-top: 1px solid var(--line-soft); padding-top: var(--sp-4); display: flex; flex-direction: column; gap: 2px; }
  .who { padding: 0 var(--sp-3) var(--sp-3); }
  .who b { display: block; font-weight: 500; }
  .who span { color: var(--ink-3); font-size: 13px; }
  main { padding: var(--sp-6) var(--sp-7) var(--sp-7); max-width: 1280px; width: 100%; }
  .tabbar { display: none; }
  .sheet { display: flex; flex-direction: column; gap: var(--sp-2); }
  .sheet .btn { justify-content: flex-start; }

  @media (max-width: 899px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    .side { display: none; }
    main { padding: var(--sp-4) var(--sp-4) 96px; }
    .tabbar {
      position: fixed; left: 0; right: 0; bottom: 0; height: 64px; z-index: 20; background: var(--paper);
      border-top: 1px solid var(--line); display: grid; grid-template-columns: repeat(4, 1fr);
    }
    .tabbar a, .tabbar button {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-1);
      font-size: 12px; color: var(--ink-3); text-decoration: none; border: 0; background: transparent; min-width: 0;
    }
    .tabbar [aria-current='page'] { color: var(--ink); font-weight: 500; }
    .tab-icon { position: relative; display: grid; }
    .dot { position: absolute; top: -2px; right: -4px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  }
</style>
