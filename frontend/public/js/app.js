(() => {
  'use strict';

  const WEEKDAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const MONTH_NAMES = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];
  const STATUS_LABELS = { present: 'Présent', absent: 'Non-présent', conge: 'Congé', rtt: 'RTT' };

  const state = {
    user: null,
    companies: [],
    cal: { year: null, month: null, targetUserId: null, targetUserName: null, data: null },
    currentView: 'calendar',
  };

  // ---------- API helper ----------
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erreur ${res.status}`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Auth ----------
  async function checkSession() {
    try {
      const me = await api('/auth/me');
      onLogin(me);
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('view-login').hidden = false;
    document.getElementById('app').hidden = true;
  }

  async function onLogin(user) {
    state.user = user;
    document.getElementById('view-login').hidden = true;
    document.getElementById('app').hidden = false;
    document.getElementById('user-name').textContent = user.fullName;
    document.getElementById('user-role-badge').textContent = user.role === 'admin' ? 'Administrateur' : (user.companyName || 'Cadre');

    const now = new Date();
    state.cal.year = now.getFullYear();
    state.cal.month = now.getMonth() + 1;
    state.cal.targetUserId = null;
    state.cal.targetUserName = null;

    if (user.role === 'admin') {
      document.getElementById('admin-nav').hidden = false;
      await loadCompaniesForSelects();
      switchView('companies');
    } else {
      document.getElementById('admin-nav').hidden = true;
      switchView('calendar');
      await loadCalendar();
    }
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');
    errBox.hidden = true;
    try {
      const user = await api('/auth/login', { method: 'POST', body: { email, password } });
      await onLogin(user);
    } catch (err) {
      errBox.textContent = err.message || 'Connexion impossible';
      errBox.hidden = false;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.user = null;
    location.reload();
  });

  // ---------- View switching ----------
  const VIEWS = ['calendar', 'companies', 'users', 'plannings', 'validation'];
  function switchView(name) {
    state.currentView = name;
    VIEWS.forEach((v) => {
      document.getElementById(`view-${v}`).hidden = v !== name;
    });
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === name);
    });
    if (name === 'companies') loadCompaniesView();
    if (name === 'users') loadUsersView();
    if (name === 'plannings') loadPlanningsView();
    if (name === 'validation') loadValidationSelectors();
  }

  document.getElementById('admin-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    if (btn.dataset.view === 'calendar') {
      state.cal.targetUserId = null;
      state.cal.targetUserName = null;
      document.getElementById('calendar-owner-name').textContent = 'Mon planning';
      document.getElementById('calendar-actions').hidden = false;
      switchView('calendar');
      loadCalendar();
      return;
    }
    switchView(btn.dataset.view);
  });

  // ================= CALENDAR =================
  const monthLabel = document.getElementById('month-label');
  const calGrid = document.getElementById('calendar-grid');
  const validationBanner = document.getElementById('validation-banner');
  const validateBtn = document.getElementById('validate-month-btn');

  document.getElementById('prev-month').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => shiftMonth(1));

  function shiftMonth(delta) {
    let { year, month } = state.cal;
    month += delta;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    state.cal.year = year;
    state.cal.month = month;
    loadCalendar();
  }

  async function loadCalendar() {
    const { year, month, targetUserId } = state.cal;
    monthLabel.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
    const qs = new URLSearchParams({ year, month });
    if (targetUserId) qs.set('user_id', targetUserId);
    try {
      const data = await api(`/attendance?${qs.toString()}`);
      state.cal.data = data;
      renderCalendar(data);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderCalendar(data) {
    const { year, month, targetUserId } = state.cal;
    const entryMap = new Map();
    data.entries.forEach((e) => entryMap.set(`${e.date}:${e.period}`, e.status));

    // banner
    const isAdmin = state.user.role === 'admin';
    validationBanner.className = 'validation-banner';
    if (data.companyValidated) {
      validationBanner.classList.add('validated');
      validationBanner.textContent = `Société validée par l'administrateur le ${fmtDate(data.companyValidatedAt)} — verrouillé`;
    } else if (data.cadreValidated) {
      validationBanner.classList.add('locked');
      validationBanner.textContent = `Mois validé le ${fmtDate(data.cadreValidatedAt)} — en attente de validation société`;
    } else {
      validationBanner.textContent = 'Mois non validé';
    }

    // validate button only shown on own calendar (cadre role, not admin browsing someone else)
    const actionsBox = document.getElementById('calendar-actions');
    if (!isAdmin && !targetUserId) {
      actionsBox.hidden = false;
      validateBtn.disabled = data.cadreValidated || data.companyValidated;
      validateBtn.textContent = data.cadreValidated ? 'Mois déjà validé' : 'Valider mon mois';
      document.getElementById('fill-workdays-btn').hidden = !data.editable;
    } else {
      actionsBox.hidden = true;
    }

    // monthly totals (half-days per status)
    const counts = { present: 0, absent: 0, conge: 0, rtt: 0 };
    data.entries.forEach((e) => { if (counts[e.status] !== undefined) counts[e.status]++; });
    document.getElementById('month-summary').innerHTML = ['present', 'absent', 'conge', 'rtt']
      .map((s) => `
        <div class="summary-tile summary-${s}">
          <span class="summary-count">${counts[s]}</span>
          <span class="summary-label">${STATUS_LABELS[s]}</span>
        </div>`)
      .join('') + `
        <div class="summary-tile summary-note">
          <span class="summary-count">${data.entries.length}</span>
          <span class="summary-label">demi-journées saisies</span>
        </div>`;

    const firstOfMonth = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    let firstWeekday = firstOfMonth.getDay(); // 0=Sun
    firstWeekday = firstWeekday === 0 ? 7 : firstWeekday; // 1=Mon..7=Sun
    const leading = firstWeekday - 1;

    calGrid.innerHTML = '';
    for (let i = 0; i < leading; i++) {
      const empty = document.createElement('div');
      empty.className = 'day-cell empty';
      calGrid.appendChild(empty);
    }

    const editable = data.editable;
    const now = new Date();
    const todayDay = now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d);
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

      const cell = document.createElement('div');
      cell.className = 'day-cell' + (isWeekend ? ' weekend' : '') + (d === todayDay ? ' today' : '');

      const num = document.createElement('div');
      num.className = 'day-number';
      num.innerHTML = `<span class="day-weekday-mobile">${WEEKDAY_SHORT[dateObj.getDay()]}</span> ${d}`;
      cell.appendChild(num);

      const row = document.createElement('div');
      row.className = 'half-day-row';

      ['AM', 'PM'].forEach((period) => {
        const status = entryMap.get(`${iso}:${period}`);
        const half = document.createElement('button');
        half.type = 'button';
        half.className = 'half-day' + (status ? ` st-${status}` : '') + (editable ? '' : ' readonly');
        half.textContent = period;
        half.dataset.date = iso;
        half.dataset.period = period;
        half.dataset.status = status || '';
        if (!editable) half.disabled = true;
        row.appendChild(half);
      });

      cell.appendChild(row);
      calGrid.appendChild(cell);
    }
  }

  // ---- Half-day popover ----
  const popover = document.getElementById('status-popover');
  let popoverTarget = null;

  calGrid.addEventListener('click', (e) => {
    const half = e.target.closest('.half-day');
    if (!half || half.disabled) return;
    popoverTarget = half;
    const label = half.dataset.period === 'AM' ? 'Matin' : 'Après-midi';
    document.getElementById('popover-title').textContent = `${half.dataset.date} — ${label}`;

    popover.hidden = false;
    const rect = half.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const margin = 8;

    let top = window.scrollY + rect.bottom + 6;
    if (rect.bottom + popRect.height + margin > viewportHeight) {
      top = window.scrollY + rect.top - popRect.height - 6;
    }
    let left = window.scrollX + rect.left;
    const maxLeft = window.scrollX + viewportWidth - popRect.width - margin;
    left = Math.min(left, Math.max(window.scrollX + margin, maxLeft));

    popover.style.top = `${Math.max(window.scrollY + margin, top)}px`;
    popover.style.left = `${left}px`;
  });

  document.addEventListener('click', (e) => {
    if (popover.hidden) return;
    if (e.target.closest('.popover') || e.target.closest('.half-day')) return;
    popover.hidden = true;
  });

  popover.addEventListener('click', async (e) => {
    const opt = e.target.closest('.popover-option');
    if (!opt || !popoverTarget) return;
    const status = opt.dataset.status;
    const { date, period } = popoverTarget.dataset;
    popover.hidden = true;
    try {
      if (status) {
        const body = { date, period, status };
        if (state.cal.targetUserId) body.user_id = state.cal.targetUserId;
        await api('/attendance', { method: 'PUT', body });
      } else {
        const body = { date, period };
        if (state.cal.targetUserId) body.user_id = state.cal.targetUserId;
        await api('/attendance', { method: 'DELETE', body });
      }
      await loadCalendar();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  validateBtn.addEventListener('click', async () => {
    if (!confirm('Confirmer la validation de votre mois ? Vous ne pourrez plus le modifier ensuite.')) return;
    try {
      await api('/validations/cadre', { method: 'POST', body: { year: state.cal.year, month: state.cal.month } });
      toast('Mois validé avec succès', 'success');
      await loadCalendar();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('fill-workdays-btn').addEventListener('click', async () => {
    const { year, month, data } = state.cal;
    if (!data) return;
    const filled = new Set(data.entries.map((e) => `${e.date}:${e.period}`));
    const entries = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) continue; // week-ends exclus
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      for (const period of ['AM', 'PM']) {
        if (!filled.has(`${iso}:${period}`)) entries.push({ date: iso, period, status: 'present' });
      }
    }
    if (entries.length === 0) {
      toast('Tous les jours ouvrés sont déjà renseignés', 'info');
      return;
    }
    if (!confirm(`Renseigner ${entries.length} demi-journées vides en « Présent » ? Les saisies existantes ne seront pas modifiées.`)) return;
    try {
      await api('/attendance/bulk', { method: 'PUT', body: { entries } });
      toast(`${entries.length} demi-journées renseignées`, 'success');
      await loadCalendar();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ================= COMPANIES (admin) =================
  async function loadCompaniesForSelects() {
    try {
      state.companies = await api('/companies');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadCompaniesView() {
    await loadCompaniesForSelects();
    const tbody = document.getElementById('companies-tbody');
    tbody.innerHTML = '';
    state.companies.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(c.name)}</td>
        <td>${c.active_cadre_count}</td>
        <td>${new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
        <td class="row-actions">
          <button class="btn btn-outline btn-sm" data-action="edit" data-id="${c.id}">Modifier</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">Supprimer</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('companies-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const company = state.companies.find((c) => String(c.id) === id);
    if (btn.dataset.action === 'edit') openCompanyModal(company);
    if (btn.dataset.action === 'delete') {
      if (!confirm(`Supprimer la société "${company.name}" ? Les cadres associés perdront leur société.`)) return;
      try {
        await api(`/companies/${id}`, { method: 'DELETE' });
        toast('Société supprimée', 'success');
        loadCompaniesView();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.getElementById('add-company-btn').addEventListener('click', () => openCompanyModal(null));

  function openCompanyModal(company) {
    const isEdit = !!company;
    openModal(`
      <h2>${isEdit ? 'Modifier la société' : 'Nouvelle société'}</h2>
      <form id="company-form">
        <label class="field"><span>Nom</span>
          <input type="text" id="company-name" required value="${isEdit ? escapeHtml(company.name) : ''}" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    `);
    document.getElementById('company-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('company-name').value.trim();
      try {
        if (isEdit) await api(`/companies/${company.id}`, { method: 'PUT', body: { name } });
        else await api('/companies', { method: 'POST', body: { name } });
        closeModal();
        toast('Société enregistrée', 'success');
        loadCompaniesView();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ================= USERS (admin) =================
  async function loadUsersView() {
    if (!state.companies.length) await loadCompaniesForSelects();
    const companySelect = document.getElementById('users-filter-company');
    companySelect.innerHTML = '<option value="">Toutes</option>' +
      state.companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    await refreshUsersTable();
  }

  document.getElementById('users-filter-company').addEventListener('change', refreshUsersTable);

  async function refreshUsersTable() {
    const companyId = document.getElementById('users-filter-company').value;
    const qs = companyId ? `?company_id=${companyId}` : '';
    try {
      const users = await api(`/users${qs}`);
      state.users = users;
      const tbody = document.getElementById('users-tbody');
      tbody.innerHTML = '';
      users.forEach((u) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(u.full_name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-cadre'}">${u.role === 'admin' ? 'Admin' : 'Cadre'}</span></td>
          <td>${u.company_name ? escapeHtml(u.company_name) : '—'}</td>
          <td><span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Actif' : 'Inactif'}</span></td>
          <td class="row-actions">
            <button class="btn btn-outline btn-sm" data-action="edit" data-id="${u.id}">Modifier</button>
            <button class="btn btn-outline btn-sm" data-action="password" data-id="${u.id}">Mot de passe</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-id="${u.id}">Supprimer</button>
          </td>`;
        tbody.appendChild(tr);
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('users-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const user = state.users.find((u) => String(u.id) === id);
    if (btn.dataset.action === 'edit') openUserModal(user);
    if (btn.dataset.action === 'password') openPasswordModal(user);
    if (btn.dataset.action === 'delete') {
      if (!confirm(`Supprimer l'utilisateur "${user.full_name}" ?`)) return;
      try {
        await api(`/users/${id}`, { method: 'DELETE' });
        toast('Utilisateur supprimé', 'success');
        refreshUsersTable();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.getElementById('add-user-btn').addEventListener('click', () => openUserModal(null));

  function companyOptions(selectedId) {
    return state.companies.map((c) =>
      `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
  }

  function openUserModal(user) {
    const isEdit = !!user;
    openModal(`
      <h2>${isEdit ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}</h2>
      <form id="user-form">
        <label class="field"><span>Nom complet</span>
          <input type="text" id="user-fullname" required value="${isEdit ? escapeHtml(user.full_name) : ''}" />
        </label>
        <label class="field"><span>E-mail</span>
          <input type="email" id="user-email" required value="${isEdit ? escapeHtml(user.email) : ''}" />
        </label>
        ${!isEdit ? `
        <label class="field"><span>Mot de passe</span>
          <input type="password" id="user-password" required minlength="6" />
        </label>` : ''}
        <label class="field"><span>Rôle</span>
          <select id="user-role">
            <option value="cadre" ${(!isEdit || user.role === 'cadre') ? 'selected' : ''}>Cadre</option>
            <option value="admin" ${isEdit && user.role === 'admin' ? 'selected' : ''}>Administrateur</option>
          </select>
        </label>
        <label class="field" id="user-company-field"><span>Société</span>
          <select id="user-company">${companyOptions(isEdit ? user.company_id : null)}</select>
        </label>
        ${isEdit ? `
        <label class="field"><span>Statut</span>
          <select id="user-active">
            <option value="true" ${user.active ? 'selected' : ''}>Actif</option>
            <option value="false" ${!user.active ? 'selected' : ''}>Inactif</option>
          </select>
        </label>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    `);

    const roleSelect = document.getElementById('user-role');
    const companyField = document.getElementById('user-company-field');
    function toggleCompanyField() {
      companyField.style.display = roleSelect.value === 'admin' ? 'none' : 'block';
    }
    roleSelect.addEventListener('change', toggleCompanyField);
    toggleCompanyField();

    document.getElementById('user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        full_name: document.getElementById('user-fullname').value.trim(),
        email: document.getElementById('user-email').value.trim(),
        role: roleSelect.value,
        company_id: roleSelect.value === 'admin' ? null : document.getElementById('user-company').value,
      };
      if (!isEdit) body.password = document.getElementById('user-password').value;
      if (isEdit) body.active = document.getElementById('user-active').value === 'true';
      try {
        if (isEdit) await api(`/users/${user.id}`, { method: 'PUT', body });
        else await api('/users', { method: 'POST', body });
        closeModal();
        toast('Utilisateur enregistré', 'success');
        refreshUsersTable();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function openPasswordModal(user) {
    openModal(`
      <h2>Nouveau mot de passe</h2>
      <p class="muted">Pour ${escapeHtml(user.full_name)}</p>
      <form id="password-form">
        <label class="field"><span>Mot de passe</span>
          <input type="password" id="new-password" required minlength="6" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">Mettre à jour</button>
        </div>
      </form>
    `);
    document.getElementById('password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('new-password').value;
      try {
        await api(`/users/${user.id}/password`, { method: 'PUT', body: { password } });
        closeModal();
        toast('Mot de passe mis à jour', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ================= PLANNINGS (admin browse) =================
  async function loadPlanningsView() {
    if (!state.companies.length) await loadCompaniesForSelects();
    const companySelect = document.getElementById('plannings-company-select');
    companySelect.innerHTML = state.companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    await refreshPlanningsCadres();
  }

  document.getElementById('plannings-company-select').addEventListener('change', refreshPlanningsCadres);

  async function refreshPlanningsCadres() {
    const companyId = document.getElementById('plannings-company-select').value;
    const cadreSelect = document.getElementById('plannings-cadre-select');
    if (!companyId) { cadreSelect.innerHTML = ''; return; }
    try {
      const users = await api(`/users?company_id=${companyId}`);
      const cadres = users.filter((u) => u.role === 'cadre');
      cadreSelect.innerHTML = cadres.map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)}</option>`).join('') ||
        '<option value="">Aucun cadre</option>';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('plannings-view-btn').addEventListener('click', async () => {
    const cadreSelect = document.getElementById('plannings-cadre-select');
    const userId = cadreSelect.value;
    if (!userId) { toast('Sélectionnez un cadre', 'error'); return; }
    const name = cadreSelect.options[cadreSelect.selectedIndex].textContent;
    state.cal.targetUserId = userId;
    state.cal.targetUserName = name;
    document.getElementById('calendar-owner-name').textContent = `Planning de ${name}`;
    switchView('calendar');
    await loadCalendar();
  });

  // ================= VALIDATION & EXPORT (admin) =================
  function loadValidationSelectors() {
    if (!state.companies.length) return loadCompaniesForSelects().then(loadValidationSelectors);
    const companySelect = document.getElementById('validation-company-select');
    if (!companySelect.dataset.filled) {
      companySelect.innerHTML = state.companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      companySelect.dataset.filled = '1';
    }
    const monthSelect = document.getElementById('validation-month-select');
    if (!monthSelect.dataset.filled) {
      monthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
      monthSelect.value = new Date().getMonth() + 1;
      monthSelect.dataset.filled = '1';
    }
    const yearSelect = document.getElementById('validation-year-select');
    if (!yearSelect.dataset.filled) {
      const currentYear = new Date().getFullYear();
      const years = [];
      for (let y = currentYear - 2; y <= currentYear + 1; y++) years.push(y);
      yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
      yearSelect.value = currentYear;
      yearSelect.dataset.filled = '1';
    }
  }

  document.getElementById('validation-load-btn').addEventListener('click', loadValidationSummary);

  let currentValidationCompanyId = null;
  let currentValidationYear = null;
  let currentValidationMonth = null;

  async function loadValidationSummary() {
    const companyId = document.getElementById('validation-company-select').value;
    const year = document.getElementById('validation-year-select').value;
    const month = document.getElementById('validation-month-select').value;
    currentValidationCompanyId = companyId;
    currentValidationYear = year;
    currentValidationMonth = month;

    try {
      const data = await api(`/validations/company/${companyId}?year=${year}&month=${month}`);
      const company = state.companies.find((c) => String(c.id) === companyId);
      document.getElementById('validation-summary-card').hidden = false;
      document.getElementById('validation-company-title').textContent =
        `${company ? company.name : ''} — ${MONTH_NAMES[month - 1]} ${year}`;

      const statusText = document.getElementById('validation-status-text');
      if (data.companyValidated) {
        statusText.textContent = `Société validée le ${fmtDate(data.companyValidatedAt)}`;
      } else if (data.allCadresValidated) {
        statusText.textContent = 'Tous les cadres ont validé — prêt pour validation société';
      } else {
        const pending = data.cadres.filter((c) => !c.cadreValidated).map((c) => c.fullName);
        statusText.textContent = pending.length
          ? `En attente de validation : ${pending.join(', ')}`
          : 'Aucun cadre actif dans cette société';
      }

      document.getElementById('validate-company-btn').disabled = data.companyValidated || !data.allCadresValidated;
      document.getElementById('reopen-company-btn').disabled = !data.companyValidated;

      const tbody = document.getElementById('validation-cadres-tbody');
      tbody.innerHTML = '';
      data.cadres.forEach((c) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(c.fullName)}</td>
          <td><span class="badge ${c.cadreValidated ? 'badge-validated' : 'badge-pending'}">${c.cadreValidated ? 'Validé' : 'En attente'}</span></td>
          <td>${c.cadreValidatedAt ? fmtDate(c.cadreValidatedAt) : '—'}</td>
          <td class="row-actions">
            <button class="btn btn-outline btn-sm" data-action="reopen-cadre" data-id="${c.id}" ${data.companyValidated ? 'disabled' : ''}>Réouvrir</button>
          </td>`;
        tbody.appendChild(tr);
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('validation-cadres-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="reopen-cadre"]');
    if (!btn) return;
    if (!confirm('Réouvrir le mois de ce cadre pour permettre des corrections ?')) return;
    try {
      await api('/validations/cadre/reopen', {
        method: 'POST',
        body: { user_id: btn.dataset.id, year: currentValidationYear, month: currentValidationMonth },
      });
      toast('Mois réouvert pour ce cadre', 'success');
      loadValidationSummary();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('validate-company-btn').addEventListener('click', async () => {
    if (!confirm('Valider définitivement cette société pour ce mois ? Les plannings seront verrouillés.')) return;
    try {
      await api(`/validations/company/${currentValidationCompanyId}`, {
        method: 'POST',
        body: { year: currentValidationYear, month: currentValidationMonth },
      });
      toast('Société validée', 'success');
      loadValidationSummary();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('reopen-company-btn').addEventListener('click', async () => {
    if (!confirm('Réouvrir la validation de cette société pour ce mois ?')) return;
    try {
      await api(`/validations/company/${currentValidationCompanyId}/reopen`, {
        method: 'POST',
        body: { year: currentValidationYear, month: currentValidationMonth },
      });
      toast('Validation société réouverte', 'success');
      loadValidationSummary();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('export-pdf-btn').addEventListener('click', () => downloadExport('pdf'));
  document.getElementById('export-excel-btn').addEventListener('click', () => downloadExport('excel'));

  function downloadExport(kind) {
    if (!currentValidationCompanyId) return;
    const url = `/api/export/${kind}/${currentValidationCompanyId}?year=${currentValidationYear}&month=${currentValidationMonth}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ================= Modal helpers =================
  const modalBackdrop = document.getElementById('modal-backdrop');
  const modalBox = document.getElementById('modal-box');

  function openModal(html) {
    modalBox.innerHTML = html;
    modalBackdrop.hidden = false;
  }
  function closeModal() {
    modalBackdrop.hidden = true;
    modalBox.innerHTML = '';
  }
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop || e.target.closest('[data-close]')) closeModal();
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ---------- Boot ----------
  checkSession();
})();
