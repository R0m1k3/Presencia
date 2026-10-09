(() => {
  'use strict';

  // ── constants ───────────────────────────────────────────────────────────
  const STATUS = {
    present: { label: 'Présent', code: 'P', cls: 'st-present', key: '1' },
    absent:  { label: 'Non-présent', code: 'NP', cls: 'st-absent', key: '2' },
    conge:   { label: 'Congé', code: 'C', cls: 'st-conge', key: '3' },
    rtt:     { label: 'RTT', code: 'R', cls: 'st-rtt', key: '4' },
  };
  const ORDER = ['present', 'absent', 'conge', 'rtt'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const WD = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const VIEWS = ['dashboard', 'planning', 'plannings', 'validation', 'companies', 'users', 'history'];
  const TITLES = {
    dashboard: 'Tableau de bord', planning: 'Mon planning', plannings: 'Plannings',
    validation: 'Validation', companies: 'Sociétés', users: 'Utilisateurs', history: 'Historique',
  };

  const now = new Date();
  const state = {
    user: null,
    view: 'dashboard',
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    cal: null,          // last /attendance payload
    viewing: null,      // { id, fullName, companyName } when an admin browses a cadre
    brush: null,
    pv: 'grid',
    pop: null,          // { date, period, day }
    companies: [],
    users: [],
    filterCompany: 'all',
    search: '',
    validationCompany: null,
    validation: null,
  };

  const $ = (id) => document.getElementById(id);

  // ── API ─────────────────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    // The session ended under us (expired, password reset, account
    // disabled): go back to the login screen instead of failing every call.
    if (res.status === 401 && state.user && path !== '/auth/login') {
      location.reload();
      return new Promise(() => {});
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erreur ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('is-error', kind === 'error');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.hidden = false;
    clearTimeout(toastTimer);
    // errors usually need reading, not just noticing
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 3000);
  }

  // Escapes quotes too: values are also interpolated into attributes
  // (value="…", data-name="…"), where a bare " would end the attribute.
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  const monthLabel = () => `${MONTHS[state.m - 1]} ${state.y}`;
  const iso = (d) => `${state.y}-${String(state.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const halfToDays = (n) => (Math.round(n / 2 * 10) / 10);

  function fmtDateTime(s) {
    if (!s) return '';
    const d = new Date(s);
    return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Fills a table body and copies each column title onto its cells
  // (data-label): on a phone, rows are shown as cards labelled that way.
  function fillTable(tbody, html) {
    tbody.innerHTML = html;
    const heads = [...tbody.closest('table').querySelectorAll('thead th')].map((th) => th.textContent.trim());
    tbody.querySelectorAll('tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
    });
  }

  // Disables a form's submit button while `fn` runs: no double submission,
  // and a visible sign that something is happening.
  async function submitting(form, fn) {
    const btn = form.querySelector('[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  // ── auth ────────────────────────────────────────────────────────────────
  async function boot() {
    let me;
    try {
      me = await api('/auth/me');
    } catch (e) {
      // No usable session — show the login screen. Any other failure below
      // must not bounce the user back here.
      $('view-login').hidden = false;
      $('app').hidden = true;
      return;
    }
    try {
      await onLogin(me);
    } catch (err) {
      toast(`Erreur au chargement de l’application : ${err.message}`, 'error');
    }
  }

  async function onLogin(user) {
    state.user = user;
    state.viewing = null;
    $('view-login').hidden = true;
    $('app').hidden = false;
    $('user-name').textContent = user.fullName;
    $('user-initials').textContent = initials(user.fullName);
    $('user-meta').textContent = user.role === 'admin'
      ? 'Administrateur'
      : `Cadre · ${user.companyName || '—'}`;

    // The company list is only needed to populate selects. If it fails, the
    // app must still come up with a usable navigation and a visible error —
    // never a blank shell.
    if (user.role === 'admin') {
      try {
        await loadCompanies();
      } catch (err) {
        state.companies = [];
        toast(`Chargement des sociétés impossible : ${err.message}`, 'error');
      }
    }
    renderNav();
    await go('dashboard');
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('login-error');
    const btn = e.target.querySelector('[type="submit"]');
    errBox.hidden = true;
    let user;
    btn.disabled = true;
    try {
      user = await api('/auth/login', {
        method: 'POST',
        body: { email: $('login-email').value.trim(), password: $('login-password').value },
      });
    } catch (err) {
      errBox.textContent = err.message || 'Connexion impossible';
      errBox.hidden = false;
      $('login-password').select();
      return;
    } finally {
      btn.disabled = false;
    }
    // Past this point the login screen is gone, so its error box would be
    // invisible: report anything that goes wrong as a toast instead.
    try {
      await onLogin(user);
    } catch (err) {
      toast(`Erreur au chargement de l’application : ${err.message}`, 'error');
    }
  });

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    location.reload();
  }
  $('logout-btn').addEventListener('click', logout);
  $('logout-btn-mobile').addEventListener('click', logout);
  $('my-password-btn').addEventListener('click', myPasswordDialog);
  $('my-password-btn-mobile').addEventListener('click', myPasswordDialog);

  function myPasswordDialog() {
    openDialog(`
      <h4 class="dialog-title" id="dialog-title">Changer mon mot de passe</h4>
      <form id="mypw-form">
        <div class="field"><label for="mypw-current">Mot de passe actuel</label>
          <input class="input" id="mypw-current" type="password" required autocomplete="current-password" /></div>
        <div class="field"><label for="mypw-new">Nouveau mot de passe</label>
          <input class="input" id="mypw-new" type="password" required minlength="8" autocomplete="new-password" />
          <span class="field-hint">8 caractères minimum. Vos autres sessions seront déconnectées.</span></div>
        <div class="field"><label for="mypw-confirm">Confirmer</label>
          <input class="input" id="mypw-confirm" type="password" required minlength="8" autocomplete="new-password" /></div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">Mettre à jour</button>
        </div>
      </form>`);
    $('mypw-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('mypw-new').value !== $('mypw-confirm').value) {
        $('mypw-confirm').setCustomValidity('Les deux mots de passe diffèrent');
        $('mypw-confirm').reportValidity();
        return;
      }
      submitting(e.target, async () => {
        await api('/auth/password', { method: 'PUT', body: { current: $('mypw-current').value, password: $('mypw-new').value } });
        closeDialog();
        toast('Mot de passe mis à jour');
      });
    });
    $('mypw-confirm').addEventListener('input', (e) => e.target.setCustomValidity(''));
  }

  // ── navigation ──────────────────────────────────────────────────────────
  function navGroups() {
    if (state.user.role === 'admin') {
      return [
        { label: 'Pilotage', items: [
          { key: 'dashboard', label: 'Tableau de bord', short: 'Accueil', icon: 'ph-squares-four' },
          { key: 'validation', label: 'Validation & export', short: 'Validation', icon: 'ph-seal-check' },
        ] },
        { label: 'Équipes', items: [
          { key: 'plannings', label: 'Plannings des cadres', short: 'Plannings', icon: 'ph-users-three' },
          { key: 'users', label: 'Utilisateurs', short: 'Comptes', icon: 'ph-user-gear' },
        ] },
        { label: 'Ma saisie', items: [{ key: 'planning', label: 'Mon planning', short: 'Ma saisie', icon: 'ph-calendar-dots' }] },
        { label: 'Configuration', items: [{ key: 'companies', label: 'Sociétés', short: 'Sociétés', icon: 'ph-buildings' }] },
      ];
    }
    return [
      { label: 'Mon mois', items: [
        { key: 'dashboard', label: 'Tableau de bord', short: 'Accueil', icon: 'ph-squares-four' },
        { key: 'planning', label: 'Mon planning', short: 'Planning', icon: 'ph-calendar-dots' },
      ] },
      { label: 'Archives', items: [{ key: 'history', label: 'Historique', short: 'Historique', icon: 'ph-clock-counter-clockwise' }] },
    ];
  }

  // Built once per session. Views must never rebuild it: replacing these nodes
  // mid-interaction detaches the button the user is clicking.
  function renderNav() {
    const groups = navGroups();
    $('side-nav').innerHTML = groups.map((g) => `
      <div>
        <div class="side-group-label">${esc(g.label)}</div>
        <div class="nav-group-items">
          ${g.items.map((it) => `
            <button class="navitem" data-nav="${it.key}" aria-current="false">
              <i class="ni-ico ph ${it.icon}"></i><span>${esc(it.label)}</span>
              <span class="ni-badge" data-badge="${it.key}" hidden></span>
            </button>`).join('')}
        </div>
      </div>`).join('');

    // Every destination, not just the first few: on a phone this bar is the
    // only navigation there is.
    const flat = groups.reduce((a, g) => a.concat(g.items), []);
    $('mobile-nav').innerHTML = flat.map((it) => `
      <button class="navitem" data-nav="${it.key}" aria-current="false" aria-label="${esc(it.label)}">
        <i class="ph ${it.icon}"></i><span>${esc(it.short)}</span>
        <span class="ni-badge" data-badge="${it.key}" hidden></span>
      </button>`).join('');
  }

  function setNavBadge(key, count) {
    document.querySelectorAll(`[data-badge="${key}"]`).forEach((el) => {
      el.textContent = count || '';
      el.hidden = !count;
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (!btn) return;
    go(btn.dataset.nav);
  });

  async function go(view) {
    state.view = view;
    state.pop = null;
    closePop();
    if (view !== 'planning') state.viewing = null;
    VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== view; });
    $('screen-title').textContent = TITLES[view] || 'Presencia';
    renderNavCurrent();
    try {
      if (view === 'dashboard') await loadDashboard();
      if (view === 'planning') await loadPlanning();
      if (view === 'plannings') await loadPlannings();
      if (view === 'validation') await loadValidationView();
      if (view === 'companies') await loadCompaniesView();
      if (view === 'users') await loadUsersView();
      if (view === 'history') await loadHistory();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderNavCurrent() {
    document.querySelectorAll('[data-nav]').forEach((b) => {
      b.setAttribute('aria-current', b.dataset.nav === state.view ? 'page' : 'false');
    });
  }

  // ── dashboard ───────────────────────────────────────────────────────────
  async function loadDashboard() {
    const isAdmin = state.user.role === 'admin';
    $('dash-greeting').textContent = `Bonjour ${String(state.user.fullName).split(' ')[0]}`;
    $('dash-company-block').hidden = !isAdmin;

    const cal = await api(`/attendance?year=${state.y}&month=${state.m}`);
    const counts = countOf(cal.entries);
    const workHalves = workdayHalves();

    if (isAdmin) {
      let ov;
      try {
        ov = await api(`/validations/overview?year=${state.y}&month=${state.m}`);
      } catch (err) {
        // A 404 here means the API is older than this page (backend image not
        // rebuilt). Say so plainly rather than leaving the dashboard blank.
        if (err.status === 404) {
          toast('API incomplète : reconstruisez aussi l’image du backend.', 'error');
        } else {
          toast(err.message, 'error');
        }
        $('dash-subtitle').textContent = `Vue d'ensemble de ${monthLabel()} indisponible.`;
        tiles([{ label: 'Ma saisie', value: `${counts.filled}/${workHalves}`, hint: 'demi-journées ouvrées' }]);
        rowActions([{
          icon: 'ph-calendar-dots', title: 'Compléter mon propre planning',
          detail: `${Math.max(0, workHalves - counts.filled)} demi-journées manquantes`, tag: 'Saisie',
          onClick: () => go('planning'),
        }]);
        renderCompanyMonthRows([]);
        return;
      }
      setNavBadge('validation', ov.pendingCompanies || 0);
      $('dash-subtitle').textContent =
        `Vue d'ensemble de ${monthLabel()} — ${ov.companies.length} société(s), ${ov.totalActiveCadres} cadre(s).`;
      tiles([
        { label: 'Sociétés', value: ov.companies.length, hint: `${ov.totalActiveCadres} cadres actifs` },
        { label: 'À valider', value: ov.pendingCompanies, hint: 'sociétés en attente' },
        { label: 'Cadres en retard', value: ov.lateCadres, hint: 'mois non validé' },
        { label: 'Ma saisie', value: `${counts.filled}/${workHalves}`, hint: 'demi-journées ouvrées' },
      ]);

      const ready = ov.companies.filter((c) => !c.companyValidated && c.activeCadres > 0 && c.validatedCadres === c.activeCadres);
      const late = ov.companies.filter((c) => !c.companyValidated && c.validatedCadres < c.activeCadres);
      const actions = [];
      ready.slice(0, 2).forEach((c) => actions.push({
        icon: 'ph-seal-check', title: `${c.name} — prêt à valider`,
        detail: `Les ${c.activeCadres} cadre(s) actif(s) ont validé leur mois`, tag: 'Validation',
        onClick: () => { state.validationCompany = String(c.id); go('validation'); },
      }));
      late.slice(0, 2).forEach((c) => actions.push({
        icon: 'ph-bell-ringing', title: `${c.name} — ${c.activeCadres - c.validatedCadres} cadre(s) en retard`,
        detail: `${c.validatedCadres}/${c.activeCadres} ont validé leur mois`, tag: 'Relance',
        onClick: () => { state.validationCompany = String(c.id); go('validation'); },
      }));
      actions.push({
        icon: 'ph-calendar-dots', title: 'Compléter mon propre planning',
        detail: `${Math.max(0, workHalves - counts.filled)} demi-journées manquantes`, tag: 'Saisie',
        onClick: () => go('planning'),
      });
      rowActions(actions);
      renderCompanyMonthRows(ov.companies);
    } else {
      const pct = workHalves ? Math.round(counts.filled / workHalves * 100) : 0;
      $('dash-subtitle').textContent = `Votre mois de ${monthLabel()} est à ${pct} % renseigné.`;
      tiles([
        { label: 'Renseigné', value: `${counts.filled}/${workHalves}`, hint: 'demi-journées ouvrées' },
        { label: 'Présent', value: `${halfToDays(counts.present)} j`, hint: 'sur le mois' },
        { label: 'Congé', value: `${halfToDays(counts.conge)} j`, hint: 'sur le mois' },
        { label: 'RTT', value: `${halfToDays(counts.rtt)} j`, hint: 'sur le mois' },
      ]);
      const validated = cal.cadreValidated || cal.companyValidated;
      rowActions([
        {
          icon: 'ph-calendar-dots',
          title: validated ? 'Mois validé — consulter' : 'Continuer ma saisie',
          detail: validated ? 'Vos saisies sont verrouillées'
            : `${Math.max(0, workHalves - counts.filled)} demi-journées à renseigner sur ${monthLabel()}`,
          tag: validated ? 'Validé' : 'À faire',
          onClick: () => go('planning'),
        },
        {
          icon: 'ph-seal-check',
          title: validated ? 'Mois transmis à l’administrateur' : 'Valider mon mois',
          detail: cal.cadreValidated ? `Validé le ${fmtDateTime(cal.cadreValidatedAt)}` : 'À faire en fin de mois',
          tag: 'Échéance',
          onClick: () => go('planning'),
        },
        {
          icon: 'ph-clock-counter-clockwise', title: 'Consulter l’historique',
          detail: 'Vos mois précédents et leurs totaux', tag: 'Historique',
          onClick: () => go('history'),
        },
      ]);
    }
  }

  function tiles(list) {
    $('dash-tiles').innerHTML = list.map((t) => `
      <div class="tile">
        <span class="tile-label">${esc(t.label)}</span>
        <span class="tile-value">${esc(t.value)}</span>
        <span class="tile-hint">${esc(t.hint)}</span>
      </div>`).join('');
  }

  function rowActions(list) {
    const box = $('dash-actions');
    box.innerHTML = list.map((a, i) => `
      <button class="rowbtn" data-action-idx="${i}">
        <i class="ph ${a.icon} rowbtn-ico"></i>
        <span class="rowbtn-text"><span>${esc(a.title)}</span><span class="rowbtn-sub">${esc(a.detail)}</span></span>
        <span class="rowbtn-right"><span class="tag tag-neutral">${esc(a.tag)}</span><i class="ph ph-arrow-right"></i></span>
      </button>`).join('');
    box.querySelectorAll('[data-action-idx]').forEach((b) => {
      b.addEventListener('click', () => list[+b.dataset.actionIdx].onClick());
    });
  }

  function renderCompanyMonthRows(companies) {
    const tb = $('dash-company-rows');
    if (!companies.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="4">Aucune société. Créez-en une dans « Sociétés ».</td></tr>';
      return;
    }
    fillTable(tb, companies.map((c) => {
      const ready = c.activeCadres > 0 && c.validatedCadres === c.activeCadres;
      const status = c.companyValidated ? 'Validée' : (ready ? 'Prête à valider' : 'En cours');
      const tagCls = c.companyValidated ? 'tag-accent' : (ready ? 'tag-outline' : 'tag-neutral');
      return `<tr>
        <td>${esc(c.name)}</td>
        <td class="cell-muted">${c.validatedCadres}/${c.activeCadres} cadres</td>
        <td><span class="tag ${tagCls}">${status}</span></td>
        <td class="cell-actions"><button class="btn btn-ghost" data-open-company="${c.id}">Ouvrir</button></td>
      </tr>`;
    }).join(''));
    tb.querySelectorAll('[data-open-company]').forEach((b) => {
      b.addEventListener('click', () => { state.validationCompany = b.dataset.openCompany; go('validation'); });
    });
  }

  // ── planning ────────────────────────────────────────────────────────────
  function workdayHalves() {
    const total = new Date(state.y, state.m, 0).getDate();
    let n = 0;
    for (let d = 1; d <= total; d++) {
      const wd = (new Date(state.y, state.m - 1, d).getDay() + 6) % 7;
      if (wd < 5) n += 2;
    }
    return n;
  }

  function countOf(entries) {
    const c = { present: 0, absent: 0, conge: 0, rtt: 0, filled: 0 };
    (entries || []).forEach((e) => { if (c[e.status] !== undefined) { c[e.status]++; c.filled++; } });
    return c;
  }

  // Clicking ‹ › quickly fires overlapping loads; only the latest may render,
  // or a slow earlier response would show the wrong month.
  let planningReq = 0;
  async function loadPlanning() {
    const req = ++planningReq;
    const qs = new URLSearchParams({ year: state.y, month: state.m });
    if (state.viewing) qs.set('user_id', state.viewing.id);
    const cal = await api(`/attendance?${qs}`);
    if (req !== planningReq) return;
    cal.key = qs.toString();
    state.cal = cal;
    renderPlanning();
  }

  function renderPlanning() {
    const data = state.cal;
    const readOnly = !!state.viewing;
    const locked = !data.editable;

    $('month-label').textContent = monthLabel();
    $('back-to-plannings').hidden = !readOnly;
    $('planning-title').textContent = readOnly ? state.viewing.fullName : 'Mon planning';
    $('planning-subtitle').textContent = readOnly
      ? `${state.viewing.companyName || '—'} — consultation et correction par l'administrateur`
      : 'Cliquez une demi-journée, ou choisissez un statut de saisie rapide puis peignez les cases.';

    // lock bar
    $('lock-icon').className = `ph ${locked ? 'ph-lock-simple' : 'ph-pencil-simple-line'} lockbar-icon`;
    let title;
    let detail;
    if (data.companyValidated) {
      title = 'Société validée — mois verrouillé';
      detail = `Validée le ${fmtDateTime(data.companyValidatedAt)}. Réouvrez la société pour corriger.`;
    } else if (data.cadreValidated) {
      title = readOnly ? 'Mois validé par le cadre' : 'Mois validé — saisies verrouillées';
      detail = readOnly
        ? `Validé le ${fmtDateTime(data.cadreValidatedAt)}. Réouvrez le mois pour corriger.`
        : `Validé le ${fmtDateTime(data.cadreValidatedAt)}. Un administrateur doit réouvrir le mois pour toute correction.`;
    } else {
      title = readOnly ? 'Correction autorisée' : 'Saisie ouverte';
      detail = readOnly ? 'Vos corrections sont enregistrées immédiatement.' : 'Validez votre mois une fois toutes vos demi-journées renseignées.';
    }
    $('lock-title').textContent = title;
    $('lock-detail').textContent = detail;

    $('validate-month-btn').hidden = readOnly || data.cadreValidated || data.companyValidated;
    $('reopen-month-btn').hidden = !(readOnly && data.cadreValidated && !data.companyValidated);
    $('fill-workdays-btn').disabled = locked;
    $('clear-month-btn').disabled = locked;

    // brushes + view modes
    $('brush-options').innerHTML = ORDER.map((k) => `
      <button class="chipbtn" data-brush="${k}" aria-pressed="${state.brush === k}" ${locked ? 'disabled' : ''}>
        <i class="dot ${STATUS[k].cls}"></i>${STATUS[k].label}
      </button>`).join('');
    $('brush-hint').textContent = state.brush
      ? `Saisie rapide active : chaque clic applique « ${STATUS[state.brush].label} »`
      : 'Astuce : activez un statut ci-dessus pour peindre plusieurs cases d’affilée.';

    $('view-options').innerHTML = [
      { k: 'grid', label: 'Grille' }, { k: 'dense', label: 'Compact' }, { k: 'list', label: 'Liste' },
    ].map((v) => `<button class="chipbtn" data-pv="${v.k}" aria-pressed="${state.pv === v.k}">${v.label}</button>`).join('');
    $('planning-view').className = `pv-${state.pv}`;

    // grid
    const entryMap = new Map();
    (data.entries || []).forEach((e) => entryMap.set(`${e.date}|${e.period}`, e.status));
    const total = new Date(state.y, state.m, 0).getDate();
    const first = (new Date(state.y, state.m - 1, 1).getDay() + 6) % 7;
    const today = new Date();
    const todayNum = today.getFullYear() === state.y && today.getMonth() + 1 === state.m ? today.getDate() : null;

    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<div class="day is-blank"></div>');
    for (let d = 1; d <= total; d++) {
      const wd = (new Date(state.y, state.m - 1, d).getDay() + 6) % 7;
      const key = iso(d);
      const half = (period) => {
        const s = entryMap.get(`${key}|${period}`);
        const long = s ? STATUS[s].label : (period === 'AM' ? 'Matin' : 'Après-midi');
        const short = s ? STATUS[s].code : period;
        return `<button class="half ${s ? STATUS[s].cls : ''}" data-date="${key}" data-period="${period}"
          ${locked ? 'disabled' : ''} title="${period === 'AM' ? 'Matin' : 'Après-midi'}">
          <span class="half-lbl-short">${short}</span><span class="half-lbl-long">${long}</span></button>`;
      };
      cells.push(`<div class="day ${wd > 4 ? 'is-weekend' : ''} ${d === todayNum ? 'is-today' : ''}">
        <span class="day-head"><span class="day-num">${d}</span><span class="day-wd">${WD[wd]}</span></span>
        <span class="halves">${half('AM')}${half('PM')}</span>
      </div>`);
    }
    while ((cells.length) % 7 !== 0) cells.push('<div class="day is-blank"></div>');
    $('cal-grid').innerHTML = cells.join('');

    // summary
    const c = countOf(data.entries);
    $('planning-summary').innerHTML = [
      { label: 'renseigné', value: `${c.filled}/${workdayHalves()}`, dot: 'st-none' },
      { label: 'présent', value: `${halfToDays(c.present)} j`, dot: 'st-present' },
      { label: 'non-présent', value: `${halfToDays(c.absent)} j`, dot: 'st-absent' },
      { label: 'congé', value: `${halfToDays(c.conge)} j`, dot: 'st-conge' },
      { label: 'RTT', value: `${halfToDays(c.rtt)} j`, dot: 'st-rtt' },
    ].map((s) => `<span class="summary-chip"><i class="dot ${s.dot}"></i>
      <span class="summary-chip-value">${s.value}</span><span class="summary-chip-label">${s.label}</span></span>`).join('');
  }

  $('prev-month').addEventListener('click', () => shiftMonth(-1));
  $('next-month').addEventListener('click', () => shiftMonth(1));
  function shiftMonth(delta) {
    let { y, m } = state;
    m += delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    state.y = y; state.m = m;
    closePop();
    loadPlanning().catch((e) => toast(e.message, 'error'));
  }

  $('back-to-plannings').addEventListener('click', () => { state.viewing = null; go('plannings'); });

  $('brush-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-brush]');
    if (!b || b.disabled) return;
    state.brush = state.brush === b.dataset.brush ? null : b.dataset.brush;
    renderPlanning();
  });

  $('view-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pv]');
    if (!b) return;
    state.pv = b.dataset.pv;
    renderPlanning();
  });

  // half-day click → brush paint or popover
  $('cal-grid').addEventListener('click', async (e) => {
    const half = e.target.closest('.half');
    if (!half || half.disabled) return;
    const { date, period } = half.dataset;
    if (state.brush) return applyHalf(date, period, state.brush);
    openPop(half, date, period);
  });

  // After a successful write, apply it to the month already in memory
  // instead of reloading the month: painting stays fluid. `cal` is the month
  // the write was made on. It is matched by month and person, not by object:
  // a reload that answered before this write landed must get it too, while a
  // different month on screen must not.
  function patchEntries(cal, changes) {
    if (!state.cal || state.cal.key !== cal.key) return;
    cal = state.cal;
    const map = new Map((cal.entries || []).map((e) => [`${e.date}|${e.period}`, e]));
    changes.forEach(({ date, period, status }) => {
      if (status) map.set(`${date}|${period}`, { date, period, status });
      else map.delete(`${date}|${period}`);
    });
    cal.entries = [...map.values()];
    renderPlanning();
  }

  // A rejected write (month locked meanwhile, session issue…) leaves the
  // screen out of date: say why, then show what the server really has.
  function writeFailed(err) {
    toast(err.message, 'error');
    loadPlanning().catch(() => {});
  }

  async function applyHalf(date, period, status) {
    closePop();
    const cal = state.cal;
    try {
      const body = status ? { date, period, status } : { date, period };
      if (state.viewing) body.user_id = state.viewing.id;
      await api('/attendance', { method: status ? 'PUT' : 'DELETE', body });
      patchEntries(cal, [{ date, period, status }]);
    } catch (err) {
      writeFailed(err);
    }
  }

  async function applyWholeDay() {
    if (!state.pop) return;
    const { date, period } = state.pop;
    const current = (state.cal.entries || []).find((e) => e.date === date && e.period === period);
    const status = (current && current.status) || state.brush || 'present';
    closePop();
    const cal = state.cal;
    try {
      const body = { entries: [{ date, period: 'AM', status }, { date, period: 'PM', status }] };
      if (state.viewing) body.user_id = state.viewing.id;
      await api('/attendance/bulk', { method: 'PUT', body });
      patchEntries(cal, body.entries);
    } catch (err) {
      writeFailed(err);
    }
  }

  // ── popover ─────────────────────────────────────────────────────────────
  function openPop(anchor, date, period) {
    state.pop = { date, period, day: parseInt(date.slice(8), 10) };
    $('pop-title').textContent = `${state.pop.day} ${MONTHS[state.m - 1]} · ${period === 'AM' ? 'matin' : 'après-midi'}`;
    $('pop-options').innerHTML = ORDER.map((k) => `
      <button class="pop-opt" data-status="${k}"><i class="dot ${STATUS[k].cls}"></i>${STATUS[k].label}
      <span class="kbd">${STATUS[k].key}</span></button>`).join('');

    const pop = $('pop');
    pop.hidden = false;
    $('pop-backdrop').hidden = false;
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pr.width - 8));
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function closePop() {
    state.pop = null;
    $('pop').hidden = true;
    $('pop-backdrop').hidden = true;
  }

  $('pop-backdrop').addEventListener('click', closePop);
  $('pop-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b || !state.pop) return;
    applyHalf(state.pop.date, state.pop.period, b.dataset.status);
  });
  $('pop-clear').addEventListener('click', () => {
    if (state.pop) applyHalf(state.pop.date, state.pop.period, null);
  });
  $('pop-whole-day').addEventListener('click', applyWholeDay);

  window.addEventListener('keydown', (ev) => {
    if (!state.pop) return;
    if (ev.key === 'Escape') return closePop();
    if (ev.key === 'Backspace') { ev.preventDefault(); return applyHalf(state.pop.date, state.pop.period, null); }
    if (ev.key === 'Enter') { ev.preventDefault(); return applyWholeDay(); }
    const i = ['1', '2', '3', '4'].indexOf(ev.key);
    if (i >= 0) { ev.preventDefault(); applyHalf(state.pop.date, state.pop.period, ORDER[i]); }
  });

  // ── planning actions ────────────────────────────────────────────────────
  $('validate-month-btn').addEventListener('click', async () => {
    if (!confirm('Confirmer la validation de votre mois ? Vous ne pourrez plus le modifier ensuite.')) return;
    try {
      await api('/validations/cadre', { method: 'POST', body: { year: state.y, month: state.m } });
      toast('Mois validé et transmis à l’administrateur');
      await loadPlanning();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('reopen-month-btn').addEventListener('click', async () => {
    if (!state.viewing) return;
    if (!confirm(`Réouvrir le mois de ${state.viewing.fullName} pour correction ?`)) return;
    try {
      await api('/validations/cadre/reopen', {
        method: 'POST', body: { user_id: state.viewing.id, year: state.y, month: state.m },
      });
      toast('Mois réouvert pour correction');
      await loadPlanning();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('fill-workdays-btn').addEventListener('click', async () => {
    const data = state.cal;
    if (!data) return;
    const filled = new Set((data.entries || []).map((e) => `${e.date}|${e.period}`));
    const entries = [];
    const total = new Date(state.y, state.m, 0).getDate();
    for (let d = 1; d <= total; d++) {
      const wd = (new Date(state.y, state.m - 1, d).getDay() + 6) % 7;
      if (wd > 4) continue;
      for (const period of ['AM', 'PM']) {
        if (!filled.has(`${iso(d)}|${period}`)) entries.push({ date: iso(d), period, status: 'present' });
      }
    }
    if (!entries.length) return toast('Tous les jours ouvrés sont déjà renseignés');
    try {
      const body = { entries };
      if (state.viewing) body.user_id = state.viewing.id;
      await api('/attendance/bulk', { method: 'PUT', body });
      toast(`${entries.length} demi-journée(s) remplie(s) en « Présent »`);
      patchEntries(data, entries);
    } catch (err) { writeFailed(err); }
  });

  $('clear-month-btn').addEventListener('click', async () => {
    const cal = state.cal;
    if (!cal || !(cal.entries || []).length) return toast('Rien à effacer pour ce mois');
    if (!confirm(`Effacer les ${cal.entries.length} saisie(s) de ${monthLabel()} ? Cette action est définitive.`)) return;
    try {
      const body = { year: state.y, month: state.m };
      if (state.viewing) body.user_id = state.viewing.id;
      await api('/attendance/month', { method: 'DELETE', body });
      toast('Mois effacé');
      patchEntries(cal, cal.entries.map((e) => ({ date: e.date, period: e.period, status: null })));
    } catch (err) { writeFailed(err); }
  });

  // ── companies ───────────────────────────────────────────────────────────
  async function loadCompanies() {
    state.companies = await api('/companies');
  }

  function companyOptions(sel, { all = false, selected = null } = {}) {
    sel.innerHTML = (all ? '<option value="all">Toutes les sociétés</option>' : '')
      + state.companies.map((c) => `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  async function loadCompaniesView() {
    await loadCompanies();
    const total = state.companies.reduce((n, c) => n + Number(c.active_cadre_count || 0), 0);
    $('companies-count').textContent = `${state.companies.length} société(s) · ${total} cadre(s) actif(s)`;
    const tb = $('companies-rows');
    if (!state.companies.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="4">Aucune société pour l’instant.</td></tr>';
      return;
    }
    fillTable(tb, state.companies.map((c) => `<tr>
      <td>${esc(c.name)}</td>
      <td class="cell-muted">${c.active_cadre_count}</td>
      <td class="cell-muted">${new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
      <td class="cell-actions">
        <button class="btn btn-ghost" data-co-rename="${c.id}">Renommer</button>
        <button class="btn btn-ghost btn-danger-ghost" data-co-delete="${c.id}">Supprimer</button>
      </td></tr>`).join(''));
  }

  $('companies-rows').addEventListener('click', async (e) => {
    const ren = e.target.closest('[data-co-rename]');
    const del = e.target.closest('[data-co-delete]');
    if (ren) return companyDialog(state.companies.find((c) => String(c.id) === ren.dataset.coRename));
    if (del) {
      const c = state.companies.find((x) => String(x.id) === del.dataset.coDelete);
      if (!confirm(`Supprimer « ${c.name} » ? Les cadres associés perdront leur société.`)) return;
      try {
        await api(`/companies/${c.id}`, { method: 'DELETE' });
        toast('Société supprimée');
        await loadCompaniesView();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  $('add-company-btn').addEventListener('click', () => companyDialog(null));

  function companyDialog(company) {
    openDialog(`
      <h4 class="dialog-title" id="dialog-title">${company ? 'Renommer la société' : 'Nouvelle société'}</h4>
      <form id="co-form">
        <div class="field"><label for="co-name">Nom</label>
          <input class="input" id="co-name" required maxlength="255" value="${company ? esc(company.name) : ''}" /></div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">${company ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>`);
    $('co-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('co-name').value.trim();
      submitting(e.target, async () => {
        if (company) await api(`/companies/${company.id}`, { method: 'PUT', body: { name } });
        else await api('/companies', { method: 'POST', body: { name } });
        closeDialog();
        toast('Société enregistrée');
        await loadCompaniesView();
      });
    });
  }

  // ── users ───────────────────────────────────────────────────────────────
  async function loadUsersView() {
    await loadCompanies();
    companyOptions($('us-co'), { all: true, selected: state.filterCompany });
    $('us-co').value = state.filterCompany;
    $('us-q').value = state.search;
    await refreshUsers();
  }

  const matches = (u) => {
    const q = state.search.trim().toLowerCase();
    return !q || `${u.full_name} ${u.email}`.toLowerCase().includes(q);
  };

  // Fetches only when the company filter changes; typing in the search box
  // filters what is already loaded (renderUsers) instead of one request per key.
  async function refreshUsers() {
    const qs = state.filterCompany !== 'all' ? `?company_id=${state.filterCompany}` : '';
    state.users = await api(`/users${qs}`);
    renderUsers();
  }

  function renderUsers() {
    const rows = state.users.filter(matches);
    const tb = $('users-rows');
    if (!rows.length) {
      tb.innerHTML = `<tr class="empty-row"><td colspan="6">${state.users.length ? 'Aucun utilisateur ne correspond à ce filtre.' : 'Aucun utilisateur.'}</td></tr>`;
      return;
    }
    const self = String(state.user.id);
    fillTable(tb, rows.map((u) => `<tr>
      <td>${esc(u.full_name)}</td>
      <td class="cell-muted">${esc(u.email)}</td>
      <td><span class="tag ${u.role === 'admin' ? 'tag-accent' : 'tag-neutral'}">${u.role === 'admin' ? 'Admin' : 'Cadre'}</span></td>
      <td class="cell-muted">${u.company_name ? esc(u.company_name) : '—'}</td>
      <td><span class="tag ${u.active ? 'tag-outline' : 'tag-neutral'}">${u.active ? 'Actif' : 'Désactivé'}</span></td>
      <td class="cell-actions">
        <button class="btn btn-ghost" data-u-edit="${u.id}">Modifier</button>
        <button class="btn btn-ghost" data-u-pw="${u.id}">Mot de passe</button>
        ${String(u.id) === self ? '' : `<button class="btn btn-ghost" data-u-toggle="${u.id}">${u.active ? 'Désactiver' : 'Activer'}</button>`}
      </td></tr>`).join(''));
  }

  $('us-co').addEventListener('change', (e) => { state.filterCompany = e.target.value; refreshUsers().catch((x) => toast(x.message, 'error')); });
  $('us-q').addEventListener('input', (e) => { state.search = e.target.value; renderUsers(); });

  $('users-rows').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-u-edit]');
    const pw = e.target.closest('[data-u-pw]');
    const tg = e.target.closest('[data-u-toggle]');
    const find = (id) => state.users.find((u) => String(u.id) === id);
    if (ed) return userDialog(find(ed.dataset.uEdit));
    if (pw) return passwordDialog(find(pw.dataset.uPw));
    if (tg) {
      const u = find(tg.dataset.uToggle);
      if (u.active && !confirm(`Désactiver le compte de ${u.full_name} ? Il ne pourra plus se connecter.`)) return;
      try {
        await api(`/users/${u.id}`, {
          method: 'PUT',
          body: { full_name: u.full_name, email: u.email, role: u.role, company_id: u.company_id, active: !u.active },
        });
        toast(u.active ? `Compte désactivé : ${u.full_name}` : `Compte activé : ${u.full_name}`);
        await refreshUsers();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  $('add-user-btn').addEventListener('click', () => userDialog(null));

  function userDialog(user) {
    const edit = !!user;
    openDialog(`
      <h4 class="dialog-title" id="dialog-title">${edit ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'}</h4>
      <form id="u-form">
        <div class="field"><label for="u-name">Nom complet</label>
          <input class="input" id="u-name" required value="${edit ? esc(user.full_name) : ''}" /></div>
        <div class="field"><label for="u-email">E-mail</label>
          <input class="input" id="u-email" type="email" required value="${edit ? esc(user.email) : ''}" /></div>
        ${edit ? '' : `<div class="field"><label for="u-pass">Mot de passe</label>
          <input class="input" id="u-pass" type="password" required minlength="8" autocomplete="new-password" />
          <span class="field-hint">8 caractères minimum. À transmettre à la personne.</span></div>`}
        <div class="field"><label for="u-role">Rôle</label>
          <select class="input" id="u-role">
            <option value="cadre" ${!edit || user.role === 'cadre' ? 'selected' : ''}>Cadre</option>
            <option value="admin" ${edit && user.role === 'admin' ? 'selected' : ''}>Administrateur</option>
          </select></div>
        <div class="field" id="u-co-field"><label for="u-co">Société</label>
          <select class="input" id="u-co"></select></div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">${edit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>`);
    companyOptions($('u-co'), { selected: edit ? user.company_id : null });
    if (!state.companies.length) {
      $('u-co').innerHTML = '<option value="">Aucune société — créez-en une d’abord</option>';
    }

    const role = $('u-role');
    // The API refuses to demote your own account; don't offer it.
    if (edit && String(user.id) === String(state.user.id)) role.disabled = true;
    const toggleCo = () => { $('u-co-field').hidden = role.value === 'admin'; };
    role.addEventListener('change', toggleCo);
    toggleCo();

    $('u-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const body = {
        full_name: $('u-name').value.trim(),
        email: $('u-email').value.trim(),
        role: role.value,
        company_id: role.value === 'admin' ? null : $('u-co').value,
      };
      if (!edit) body.password = $('u-pass').value;
      else body.active = user.active;
      submitting(e.target, async () => {
        if (edit) await api(`/users/${user.id}`, { method: 'PUT', body });
        else await api('/users', { method: 'POST', body });
        closeDialog();
        if (!edit) {
          // The company filter and search are shared with "Plannings": a leftover
          // value would hide the account just created, as if it had not been saved.
          state.filterCompany = 'all';
          state.search = '';
          $('us-co').value = 'all';
          $('us-q').value = '';
        }
        toast('Utilisateur enregistré');
        await refreshUsers();
      });
    });
  }

  function passwordDialog(user) {
    openDialog(`
      <h4 class="dialog-title" id="dialog-title">Nouveau mot de passe</h4>
      <p class="lede">Pour ${esc(user.full_name)}</p>
      <form id="pw-form">
        <div class="field"><label for="pw-new">Mot de passe</label>
          <input class="input" id="pw-new" type="password" required minlength="8" autocomplete="new-password" />
          <span class="field-hint">8 caractères minimum. Ses sessions ouvertes seront déconnectées.</span></div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">Mettre à jour</button>
        </div>
      </form>`);
    $('pw-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(e.target, async () => {
        await api(`/users/${user.id}/password`, { method: 'PUT', body: { password: $('pw-new').value } });
        closeDialog();
        toast('Mot de passe mis à jour');
      });
    });
  }

  // ── plannings (admin) ───────────────────────────────────────────────────
  async function loadPlannings() {
    await loadCompanies();
    companyOptions($('pl-co'), { all: true, selected: state.filterCompany });
    $('pl-co').value = state.filterCompany;
    $('pl-q').value = state.search;
    $('plannings-subtitle').textContent = `Consultez ou corrigez le planning d'un cadre pour ${monthLabel()}.`;
    await refreshCadreRows();
  }

  // Loads cadres and, per company, their month status (all companies in
  // parallel). The search box then filters locally (renderCadreRows).
  let cadreData = { cadres: [], byId: new Map() };
  async function refreshCadreRows() {
    const qs = state.filterCompany !== 'all' ? `?company_id=${state.filterCompany}` : '';
    const cadres = (await api(`/users${qs}`)).filter((u) => u.role === 'cadre');
    const byId = new Map();
    const companyIds = [...new Set(cadres.map((c) => c.company_id).filter(Boolean))];
    await Promise.all(companyIds.map((cid) => api(`/validations/company/${cid}?year=${state.y}&month=${state.m}`)
      .then((v) => v.cadres.forEach((c) => byId.set(c.id, c)))
      .catch(() => { /* company may have been removed */ })));
    cadreData = { cadres, byId };
    renderCadreRows();
  }

  function renderCadreRows() {
    const { byId } = cadreData;
    const cadres = cadreData.cadres.filter(matches);
    const box = $('cadre-rows');
    if (!cadres.length) {
      box.innerHTML = `<p class="lede">${cadreData.cadres.length ? 'Aucun cadre ne correspond à ce filtre.' : 'Aucun cadre. Créez des comptes « Cadre » dans Utilisateurs.'}</p>`;
      return;
    }
    const work = workdayHalves();
    box.innerHTML = cadres.map((u) => {
      const v = byId.get(u.id);
      const filled = v ? v.filled : 0;
      const status = !u.active ? 'Inactif' : (v && v.cadreValidated ? 'Validé' : 'En cours');
      const tagCls = !u.active ? 'tag-neutral' : (v && v.cadreValidated ? 'tag-accent' : 'tag-outline');
      return `<button class="rowbtn" data-cadre="${u.id}" data-name="${esc(u.full_name)}" data-co="${esc(u.company_name || '')}">
        <span class="avatar neutral">${esc(initials(u.full_name))}</span>
        <span class="rowbtn-text"><span>${esc(u.full_name)}</span>
          <span class="rowbtn-sub">${esc(u.company_name || '—')}</span></span>
        <span class="rowbtn-right">
          <span class="rowbtn-sub">${filled}/${work} demi-journées</span>
          <span class="tag ${tagCls}">${status}</span></span>
      </button>`;
    }).join('');
  }

  $('pl-co').addEventListener('change', (e) => { state.filterCompany = e.target.value; refreshCadreRows().catch((x) => toast(x.message, 'error')); });
  $('pl-q').addEventListener('input', (e) => { state.search = e.target.value; renderCadreRows(); });

  $('cadre-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cadre]');
    if (!b) return;
    openCadre({ id: b.dataset.cadre, fullName: b.dataset.name, companyName: b.dataset.co });
  });

  function openCadre(cadre) {
    state.viewing = cadre;
    state.view = 'planning';
    VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== 'planning'; });
    $('screen-title').textContent = TITLES.planning;
    renderNavCurrent();
    loadPlanning().catch((err) => toast(err.message, 'error'));
  }

  // ── validation & export ─────────────────────────────────────────────────
  async function loadValidationView() {
    await loadCompanies();
    if (!state.companies.length) {
      $('validation-company-name').textContent = 'Aucune société';
      $('validation-status-text').textContent = 'Créez une société pour commencer.';
      $('validation-rows').innerHTML = '';
      $('validation-progress').style.width = '0%';
      $('validate-company-btn').disabled = true;
      return;
    }
    if (!state.validationCompany || !state.companies.some((c) => String(c.id) === String(state.validationCompany))) {
      state.validationCompany = String(state.companies[0].id);
    }
    companyOptions($('va-co'), { selected: state.validationCompany });
    $('va-co').value = state.validationCompany;

    const opts = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(state.y, state.m - 1 - i, 1);
      opts.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
    }
    $('va-mo').innerHTML = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    $('va-mo').value = `${state.y}-${String(state.m).padStart(2, '0')}`;

    await refreshValidation();
  }

  async function refreshValidation() {
    const co = state.companies.find((c) => String(c.id) === String(state.validationCompany));
    const data = await api(`/validations/company/${state.validationCompany}?year=${state.y}&month=${state.m}`);
    state.validation = data;

    const okCount = data.cadres.filter((c) => c.cadreValidated).length;
    $('validation-company-name').textContent = `${co ? co.name : ''} — ${monthLabel()}`;
    $('validation-status-text').textContent = data.companyValidated
      ? `Société validée le ${fmtDateTime(data.companyValidatedAt)}`
      : `${okCount} cadre(s) sur ${data.cadres.length} ont validé leur mois`;
    $('validation-progress').style.width = `${data.cadres.length ? Math.round(okCount / data.cadres.length * 100) : 0}%`;

    const btn = $('validate-company-btn');
    btn.textContent = data.companyValidated ? 'Réouvrir la société' : 'Valider la société';
    btn.disabled = !data.companyValidated && !data.allCadresValidated;

    const work = workdayHalves();
    const tb = $('validation-rows');
    if (!data.cadres.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="4">Aucun cadre actif dans cette société.</td></tr>';
      return;
    }
    fillTable(tb, data.cadres.map((c) => `<tr>
      <td>${esc(c.fullName)}</td>
      <td class="cell-muted">${c.filled}/${work}</td>
      <td><span class="tag ${c.cadreValidated ? 'tag-accent' : 'tag-outline'}">${c.cadreValidated ? 'Validé' : 'En cours'}</span></td>
      <td class="cell-actions">
        <button class="btn btn-ghost" data-v-open="${c.id}" data-name="${esc(c.fullName)}">Voir</button>
        ${c.cadreValidated && !data.companyValidated ? `<button class="btn btn-ghost" data-v-reopen="${c.id}">Réouvrir</button>` : ''}
      </td></tr>`).join(''));
  }

  $('va-co').addEventListener('change', (e) => { state.validationCompany = e.target.value; refreshValidation().catch((x) => toast(x.message, 'error')); });
  $('va-mo').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    state.y = y; state.m = m;
    refreshValidation().catch((x) => toast(x.message, 'error'));
  });

  $('validation-rows').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-v-open]');
    const reopen = e.target.closest('[data-v-reopen]');
    if (open) {
      const co = state.companies.find((c) => String(c.id) === String(state.validationCompany));
      return openCadre({ id: open.dataset.vOpen, fullName: open.dataset.name, companyName: co ? co.name : '' });
    }
    if (reopen) {
      if (!confirm('Réouvrir le mois de ce cadre pour permettre des corrections ?')) return;
      try {
        await api('/validations/cadre/reopen', { method: 'POST', body: { user_id: reopen.dataset.vReopen, year: state.y, month: state.m } });
        toast('Mois réouvert pour ce cadre');
        await refreshValidation();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  $('validate-company-btn').addEventListener('click', async () => {
    const validated = state.validation && state.validation.companyValidated;
    const msg = validated
      ? 'Réouvrir la validation de cette société pour ce mois ?'
      : 'Valider définitivement cette société pour ce mois ? Les plannings seront verrouillés.';
    if (!confirm(msg)) return;
    try {
      const path = `/validations/company/${state.validationCompany}${validated ? '/reopen' : ''}`;
      await api(path, { method: 'POST', body: { year: state.y, month: state.m } });
      toast(validated ? 'Validation société réouverte' : 'Société validée');
      await refreshValidation();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('export-pdf-btn').addEventListener('click', (e) => download('pdf', e.currentTarget));
  $('export-excel-btn').addEventListener('click', (e) => download('excel', e.currentTarget));

  // Fetched rather than navigated to, so that a failure shows as a message
  // instead of downloading a file that contains the JSON error.
  async function download(kind, btn) {
    if (!state.validationCompany || btn.disabled) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/export/${kind}/${state.validationCompany}?year=${state.y}&month=${state.m}`, { credentials: 'include' });
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch (e) { /* not JSON */ }
        throw new Error(msg);
      }
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/);
      const name = m ? decodeURIComponent(m[1]) : `presences.${kind === 'pdf' ? 'pdf' : 'xlsx'}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ── history ─────────────────────────────────────────────────────────────
  async function loadHistory() {
    const rows = await api('/attendance/history');
    const tb = $('history-rows');
    if (!rows.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="7">Aucune saisie enregistrée pour le moment.</td></tr>';
      return;
    }
    fillTable(tb, rows.map((r) => {
      const status = r.companyValidated ? 'Validé société' : (r.cadreValidated ? 'Validé cadre' : 'En cours');
      const tagCls = r.companyValidated ? 'tag-accent' : (r.cadreValidated ? 'tag-outline' : 'tag-neutral');
      return `<tr>
        <td class="cell-capitalize">${MONTHS[r.month - 1]} ${r.year}</td>
        <td class="cell-muted">${halfToDays(r.present)} j</td>
        <td class="cell-muted">${halfToDays(r.absent)} j</td>
        <td class="cell-muted">${halfToDays(r.conge)} j</td>
        <td class="cell-muted">${halfToDays(r.rtt)} j</td>
        <td><span class="tag ${tagCls}">${status}</span></td>
        <td class="cell-actions"><button class="btn btn-ghost" data-hist="${r.year}-${r.month}">Ouvrir</button></td>
      </tr>`;
    }).join(''));
  }

  $('history-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hist]');
    if (!b) return;
    const [y, m] = b.dataset.hist.split('-').map(Number);
    state.y = y; state.m = m;
    go('planning');
  });

  // ── dialog ──────────────────────────────────────────────────────────────
  let dialogOpener = null;
  function openDialog(html) {
    dialogOpener = document.activeElement;
    $('dialog').innerHTML = html;
    $('dialog-backdrop').hidden = false;
    const first = $('dialog').querySelector('input:not([disabled]), select:not([disabled])');
    if (first) first.focus();
  }
  function closeDialog() {
    $('dialog-backdrop').hidden = true;
    $('dialog').innerHTML = '';
    // back to the button that opened it, for keyboard users
    if (dialogOpener && document.contains(dialogOpener)) dialogOpener.focus();
    dialogOpener = null;
  }
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('dialog-backdrop').hidden) closeDialog();
  });
  $('dialog-backdrop').addEventListener('click', (e) => {
    if (e.target === $('dialog-backdrop') || e.target.closest('[data-close]')) closeDialog();
  });

  boot();
})();
