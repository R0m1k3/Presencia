<script lang="ts">
  import { api, message } from '../lib/api.ts';
  import { session } from '../lib/session.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import type { Me } from '../lib/types.ts';

  let email = $state('');
  let password = $state('');
  let err = $state('');
  let busy = $state(false);
  let pwdInput: HTMLInputElement;

  // A month of half-days for the left panel: the product's own picture.
  const demo = 'PP PP PP PP PC .. .. PP PP PN PP PP .. .. CC CC PP PP PP .. .. PP RR PP PP PP .. .. PP PP'.split(' ');
  const cls: Record<string, string> = { P: 'present', N: 'absent', C: 'conge', R: 'rtt', '.': 'off' };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    err = '';
    busy = true;
    try {
      session.user = await api<Me>('/auth/login', 'POST', { email, password });
      const back = session.wanted;
      session.wanted = null;
      go(back && back !== '/connexion' ? back : '/', true);
    } catch (e) {
      err = message(e);
      password = '';
      pwdInput?.focus();
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <section class="intro" aria-hidden="true">
    <div class="brand"><span class="mark"><i></i><i></i></span>Presencia</div>
    <div class="ribbon">
      {#each demo as d, i (i)}<span class="d"><i class={cls[d[0]]}></i><i class={cls[d[1]]}></i></span>{/each}
    </div>
    <p class="claim">Les présences de vos cadres, par demi-journée, validées chaque mois</p>
  </section>

  <section class="form-side">
    <form class="card" onsubmit={submit}>
      <h1>Connexion</h1>
      <label class="field"><span>E-mail</span>
        <input class="input" type="email" autocomplete="username" required bind:value={email} />
      </label>
      <label class="field"><span>Mot de passe</span>
        <input class="input" type="password" autocomplete="current-password" required bind:value={password} bind:this={pwdInput} />
      </label>
      {#if err}<p class="form-error" role="alert">{err}</p>{/if}
      <button class="btn primary" type="submit" disabled={busy}>Se connecter</button>
      <p class="hint">Les comptes sont créés par un administrateur.</p>
    </form>
  </section>
</div>

<style>
  .login { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; }
  .intro {
    background: var(--paper); border-right: 1px solid var(--line); padding: var(--sp-7);
    display: flex; flex-direction: column; justify-content: space-between; gap: var(--sp-6);
  }
  .brand { display: flex; align-items: center; gap: var(--sp-2); font-weight: 600; font-size: 17px; }
  .mark { width: 22px; height: 22px; display: grid; grid-template-rows: 1fr 1fr; gap: 2px; }
  .mark i:first-child { background: var(--present-bar); border-radius: 4px 4px 1px 1px; }
  .mark i:last-child { background: var(--ink); border-radius: 1px 1px 4px 4px; }
  .ribbon { display: grid; grid-template-columns: repeat(30, 1fr); gap: 4px; height: 56px; max-width: 560px; }
  .d { display: grid; grid-template-rows: 1fr 1fr; gap: 3px; }
  .d i { border-radius: 2px; background: var(--empty-bar); }
  .d i.off { background: var(--raised); }
  .d i.present { background: var(--present-bar); }
  .d i.absent { background: var(--absent-bar); }
  .d i.conge { background: var(--conge-bar); }
  .d i.rtt { background: var(--rtt-bar); }
  .claim { font-size: 28px; line-height: 1.25; font-weight: 500; letter-spacing: -0.01em; max-width: 18em; }
  .form-side { display: grid; place-items: center; padding: var(--sp-6) var(--sp-4); }
  .card { width: min(360px, 100%); display: flex; flex-direction: column; gap: var(--sp-4); }
  h1 { font-size: 28px; font-weight: 500; }
  .card .btn { height: 44px; }

  @media (max-width: 899px) {
    .login { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    .intro { border-right: 0; border-bottom: 1px solid var(--line); padding: var(--sp-5) var(--sp-4); gap: var(--sp-4); }
    .ribbon { height: 36px; gap: 2px; }
    .claim { font-size: 20px; }
    .form-side { place-items: start center; }
  }
</style>
