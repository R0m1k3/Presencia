<script lang="ts">
  import { setLucideProps } from '@lucide/svelte/context';
  import Shell from './components/Shell.svelte';
  import Toasts from './components/Toasts.svelte';
  import ConfirmHost from './components/ConfirmHost.svelte';
  import Login from './routes/Login.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import Planning from './routes/Planning.svelte';
  import Plannings from './routes/Plannings.svelte';
  import Validation from './routes/Validation.svelte';
  import Companies from './routes/Companies.svelte';
  import Users from './routes/Users.svelte';
  import History from './routes/History.svelte';
  import { api, setUnauthorizedHandler } from './lib/api.ts';
  import { session } from './lib/session.svelte.ts';
  import { router, segments, go } from './lib/router.svelte.ts';
  import { currentYm, parseYm, ymKey } from './lib/logic/dates.ts';
  import { error } from './lib/toast.svelte.ts';
  import type { Me } from './lib/types.ts';

  setLucideProps({ size: 18, strokeWidth: 1.5 });

  setUnauthorizedHandler(() => {
    if (!session.user) return;
    session.user = null;
    session.wanted = router.path;
    error('Votre session a expiré. Reconnectez-vous.');
    go('/connexion', true);
  });

  api<Me>('/auth/me')
    .then((me) => (session.user = me))
    .catch(() => {
      session.wanted = router.path;
    })
    .finally(() => (session.ready = true));

  const ADMIN_ONLY = new Set(['plannings', 'validation', 'societes', 'utilisateurs']);

  /** The screen for the current address, after the role checks. */
  const view = $derived.by(() => {
    const seg = segments(router.path);
    const [head = '', a, b] = seg;
    const admin = session.isAdmin;
    const now = ymKey(currentYm());
    if (ADMIN_ONLY.has(head) && !admin) return { kind: 'redirect' as const, to: '/' };
    switch (head) {
      case '':
        return { kind: 'dashboard' as const };
      case 'planning': {
        const ym = parseYm(a);
        return ym ? { kind: 'planning' as const, ym, userId: null } : { kind: 'redirect' as const, to: `/planning/${now}` };
      }
      case 'plannings': {
        if (b !== undefined) {
          const ym = parseYm(b);
          const id = Number(a);
          if (ym && Number.isInteger(id) && id > 0) return { kind: 'planning' as const, ym, userId: id };
          return { kind: 'redirect' as const, to: `/plannings/${now}` };
        }
        const ym = parseYm(a);
        return ym ? { kind: 'plannings' as const, ym } : { kind: 'redirect' as const, to: `/plannings/${now}` };
      }
      case 'validation': {
        const ym = parseYm(a);
        const cid = b === undefined ? null : Number(b);
        if (!ym || (cid !== null && !(Number.isInteger(cid) && cid > 0))) return { kind: 'redirect' as const, to: `/validation/${now}` };
        return { kind: 'validation' as const, ym, companyId: cid };
      }
      case 'societes':
        return { kind: 'companies' as const };
      case 'utilisateurs':
        return { kind: 'users' as const };
      case 'historique':
        return admin ? { kind: 'redirect' as const, to: '/' } : { kind: 'history' as const };
      default:
        return { kind: 'redirect' as const, to: '/' };
    }
  });

  $effect(() => {
    if (!session.ready) return;
    if (!session.user && router.path !== '/connexion') go('/connexion', true);
    else if (session.user && router.path === '/connexion') go('/', true);
    else if (session.user && view.kind === 'redirect') go(view.to, true);
  });

  // Page title follows the screen.
  $effect(() => {
    const titles: Record<string, string> = {
      dashboard: 'Tableau de bord', planning: 'Planning', plannings: 'Plannings', validation: 'Validation',
      companies: 'Sociétés', users: 'Utilisateurs', history: 'Historique',
    };
    document.title = session.user ? `${titles[view.kind] ?? ''} · Presencia` : 'Connexion · Presencia';
  });
</script>

{#if !session.ready}
  <div class="boot" aria-busy="true"></div>
{:else if !session.user}
  <Login />
{:else}
  <Shell>
    {#if view.kind === 'dashboard'}
      <Dashboard />
    {:else if view.kind === 'planning'}
      {#key `${ymKey(view.ym)}|${view.userId}`}
        <Planning ym={view.ym} userId={view.userId} />
      {/key}
    {:else if view.kind === 'plannings'}
      {#key ymKey(view.ym)}<Plannings ym={view.ym} />{/key}
    {:else if view.kind === 'validation'}
      {#key `${ymKey(view.ym)}|${view.companyId}`}<Validation ym={view.ym} companyId={view.companyId} />{/key}
    {:else if view.kind === 'companies'}
      <Companies />
    {:else if view.kind === 'users'}
      <Users />
    {:else if view.kind === 'history'}
      <History />
    {/if}
  </Shell>
{/if}

<Toasts />
<ConfirmHost />

<style>
  .boot { min-height: 100vh; }
</style>
