/* LeadFlow CRM - Main Application Controller */
const App = (() => {
  let currentPage = 'dashboard';
  let currentLeadId = null;
  let leadListState = { page: 1, perPage: 15, sort: 'updatedAt', sortDir: 'desc', filters: {} };
  let submitting = false;

  /* ========== INIT ========== */
  function bootStage(msg) {
    const el = document.getElementById('boot-status');
    if (el) el.textContent = msg;
  }

  async function init() {
    try {
      showBootLoading(true);
      bootStage('Starting database…');
      await DB.open();
      bootStage('Checking account…');
      const needsSetup = await Auth.ensureSetup();
      const signature = await DB.getSetting('appSignature', null);
      const legacyDetected = !needsSetup && !signature;
      const user = await Auth.restoreSession();

      if (needsSetup) {
        bootStage('Preparing setup…');
        showSetup();
      } else if (legacyDetected && !user) {
        bootStage('Checking existing database…');
        showLegacyDatabaseScreen();
      } else if (user) {
        bootStage('Loading dashboard…');
        await showApp();
      } else {
        bootStage('Preparing login…');
        showLogin();
      }
      showBootLoading(false);
      window.__leadflowStarted = true;
    } catch (e) {
      console.error('Startup error:', e);
      showBootLoading(false);
      try {
        const msg = (e && e.message) ? e.message : String(e);
        document.getElementById('app').innerHTML = `
          <div class="login-page">
            <div class="login-card">
              <div class="login-logo"><div class="logo-icon">⚠</div>
              <h1>Database Error</h1>
              <p style="color:var(--text);margin-bottom:0.75rem">${Utils.escapeHtml(msg)}</p>
              <p class="text-muted" style="font-size:0.875rem;margin-bottom:1rem">
                This can happen if an older LeadFlow database exists in this browser.
                Try <strong>Retry</strong> first. If it still fails, use <strong>Reset Database</strong>
                (this clears local LeadFlow data for this browser only).
              </p>
              <button class="btn btn-primary w-full" id="db-retry-btn">Retry</button>
              <button class="btn btn-outline w-full mt-1" id="db-reset-btn">Reset Database &amp; Restart</button>
            </div>
          </div>
          <div id="toast-container" class="toast-container"></div>`;
        document.getElementById('db-retry-btn').onclick = () => location.reload();
        document.getElementById('db-reset-btn').onclick = async () => {
          try {
            await DB.deleteDatabase();
            // Also clear session leftovers
            try { sessionStorage.clear(); } catch (_) {}
            try {
              Object.keys(localStorage).forEach(k => {
                if (k.startsWith('leadflow')) localStorage.removeItem(k);
              });
            } catch (_) {}
            location.reload();
          } catch (err) {
            alert('Could not reset database: ' + err.message + '\n\nClose other LeadFlow tabs and try again.');
          }
        };
        window.__leadflowStarted = true;
      } catch (e2) {
        console.error('Failed even to render the error screen:', e2);
      }
    }
  }

  function showBootLoading(show) {
    const el = document.getElementById('boot-loading');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  /* ========== TOAST & MODAL ========== */
  function toast(title, msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <div class="toast-content">
        <div class="toast-title">${Utils.escapeHtml(title)}</div>
        ${msg ? `<div class="toast-msg">${Utils.escapeHtml(msg)}</div>` : ''}
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 4500);
  }

  function openModal(html, opts = {}) {
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `<div class="modal ${opts.size || ''}">${html}</div>`;
    overlay.classList.add('show');
    overlay.onclick = (e) => { if (e.target === overlay && !opts.persistent) closeModal(); };
  }

  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('show');
    overlay.innerHTML = '';
  }

  function confirm(title, message, detail = '') {
    return new Promise(resolve => {
      openModal(`
        <div class="modal-header"><h2>${Utils.escapeHtml(title)}</h2>
          <button class="modal-close" id="cfm-x">×</button></div>
        <div class="modal-body">
          <div class="confirm-icon">❓</div>
          <div class="confirm-message">${Utils.escapeHtml(message)}</div>
          ${detail ? `<div class="confirm-detail">${Utils.escapeHtml(detail)}</div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="cfm-no">Cancel</button>
          <button class="btn btn-danger" id="cfm-yes">Confirm</button>
        </div>`, { size: 'modal-sm', persistent: true });
      document.getElementById('cfm-yes').onclick = () => { closeModal(); resolve(true); };
      document.getElementById('cfm-no').onclick = () => { closeModal(); resolve(false); };
      document.getElementById('cfm-x').onclick = () => { closeModal(); resolve(false); };
    });
  }

  /* ========== LOGIN / SETUP ========== */
  function showLogin(opts = {}) {
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card" id="login-card">
          <div class="login-logo">
            <div class="logo-icon">📊</div>
            <h1>LeadFlow CRM</h1>
            <p>Professional Lead Management</p>
          </div>
          <div id="login-form-area"></div>
        </div>
      </div>
      <div id="toast-container" class="toast-container"></div>
      <div id="modal-overlay" class="modal-overlay"></div>`;
    if (opts.forgot) renderForgotForm();
    else renderLoginForm();
  }

  function renderLoginForm() {
    document.getElementById('login-form-area').innerHTML = `
      <form id="login-form">
        <div class="form-group">
          <label>Username</label>
          <input class="form-control" id="login-username" autocomplete="username" required autofocus>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input class="form-control" type="password" id="login-password" autocomplete="current-password" required>
        </div>
        <div class="form-group">
          <label class="form-check"><input type="checkbox" id="login-remember"> Remember Me</label>
        </div>
        <button type="submit" class="btn btn-primary w-full btn-lg" id="login-btn">Sign In</button>
        <div class="text-center mt-2">
          <button type="button" class="btn btn-ghost btn-sm" id="forgot-link">Forgot Password?</button>
          &nbsp;·&nbsp;
          <button type="button" class="btn btn-ghost btn-sm" id="reset-db-link" style="color:var(--danger)">Reset Local Database</button>
        </div>
      </form>`;
    document.getElementById('login-form').onsubmit = handleLogin;
    document.getElementById('forgot-link').onclick = () => renderForgotForm();
    const resetLink = document.getElementById('reset-db-link');
    if (resetLink) {
      resetLink.onclick = async () => {
        const ok = await confirm('Reset Local Database', 'Erase all local LeadFlow data and restart setup?', 'This permanently deletes leads, payments, users and documents stored in this browser.');
        if (!ok) return;
        await DB.deleteDatabase();
        try { sessionStorage.clear(); } catch (_) {}
        try { localStorage.clear(); } catch (_) {}
        location.reload();
      };
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await Auth.login(
        document.getElementById('login-username').value,
        document.getElementById('login-password').value,
        document.getElementById('login-remember').checked
      );
      toast('Welcome', 'Login successful', 'success');
      await showApp();
    } catch (err) {
      toast('Login Failed', err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  function renderForgotForm() {
    document.getElementById('login-form-area').innerHTML = `
      <h3 style="margin-bottom:1rem;font-size:1.1rem;">Password Recovery</h3>
      <form id="forgot-form">
        <div class="form-group">
          <label>Username</label>
          <input class="form-control" id="forgot-username" required>
        </div>
        <button type="button" class="btn btn-outline w-full mb-2" id="btn-get-question">Get Security Question</button>
        <div id="forgot-step2" class="hidden">
          <div class="form-group">
            <label>Security Question</label>
            <input class="form-control" id="forgot-question" readonly>
          </div>
          <div class="form-group">
            <label>Your Answer</label>
            <input class="form-control" id="forgot-answer" required>
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input class="form-control" type="password" id="forgot-newpass" required minlength="6">
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input class="form-control" type="password" id="forgot-confirm" required>
          </div>
          <button type="submit" class="btn btn-primary w-full">Reset Password</button>
        </div>
        <div class="text-center mt-2">
          <button type="button" class="btn btn-ghost btn-sm" id="back-login">← Back to Login</button>
        </div>
      </form>`;
    document.getElementById('btn-get-question').onclick = async () => {
      try {
        const q = await Auth.getSecurityQuestion(document.getElementById('forgot-username').value);
        document.getElementById('forgot-question').value = q;
        document.getElementById('forgot-step2').classList.remove('hidden');
      } catch (err) { toast('Error', err.message, 'error'); }
    };
    document.getElementById('forgot-form').onsubmit = async (e) => {
      e.preventDefault();
      const np = document.getElementById('forgot-newpass').value;
      const cp = document.getElementById('forgot-confirm').value;
      if (np !== cp) { toast('Error', 'Passwords do not match', 'error'); return; }
      try {
        await Auth.recoverPassword(
          document.getElementById('forgot-username').value,
          document.getElementById('forgot-answer').value,
          np
        );
        toast('Success', 'Password reset successfully. Please login.', 'success');
        renderLoginForm();
      } catch (err) { toast('Error', err.message, 'error'); }
    };
    document.getElementById('back-login').onclick = () => renderLoginForm();
  }

  function showLegacyDatabaseScreen() {
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="login-logo">
            <div class="logo-icon">⚠️</div>
            <h1>Existing Data Found</h1>
            <p>A database from a different/older LeadFlow build was detected.</p>
          </div>
          <div class="setup-banner">
            The saved accounts use an older password format that this version cannot read,
            which is why login shows <strong>"Invalid username or password."</strong>
          </div>
          <p class="text-muted mb-2" style="font-size:0.875rem">Choose how to continue:</p>
          <button class="btn btn-danger w-full btn-lg mb-1" id="legacy-reset">Start Fresh — Erase Old Data &amp; Setup Admin</button>
          <button class="btn btn-outline w-full" id="legacy-continue">Keep Old Data — Go to Login</button>
          <p class="form-hint mt-2 text-center">
            If the old data matters, choose Keep, close the app, and contact support to migrate.
            Starting fresh permanently deletes the old local database in this browser.
          </p>
        </div>
      </div>
      <div id="toast-container" class="toast-container"></div>
      <div id="modal-overlay" class="modal-overlay"></div>`;

    document.getElementById('legacy-reset').onclick = async () => {
      const ok = await confirm('Erase Old Database', 'This will permanently delete ALL existing local LeadFlow data in this browser, then let you create a new admin account.', 'This cannot be undone.');
      if (!ok) return;
      await DB.deleteDatabase();
      try { sessionStorage.clear(); } catch (_) {}
      try {
        Object.keys(localStorage).forEach(k => { if (k.startsWith('leadflow')) localStorage.removeItem(k); });
      } catch (_) {}
      location.reload();
    };
    document.getElementById('legacy-continue').onclick = () => showLogin();
  }

  function showSetup() {
    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card" style="max-width:480px">
          <div class="login-logo">
            <div class="logo-icon">📊</div>
            <h1>LeadFlow CRM</h1>
            <p>Initial Setup</p>
          </div>
          <div class="setup-banner">👋 Welcome! Create your administrator account to get started. No demo data will be created.</div>
          <form id="setup-form">
            <div class="form-group"><label>Full Name <span class="required">*</span></label>
              <input class="form-control" id="setup-name" required></div>
            <div class="form-group"><label>Username <span class="required">*</span></label>
              <input class="form-control" id="setup-username" required minlength="3"></div>
            <div class="form-group"><label>Email</label>
              <input class="form-control" type="email" id="setup-email"></div>
            <div class="form-group"><label>Company / CRM Name</label>
              <input class="form-control" id="setup-company" value="LeadFlow CRM"></div>
            <div class="form-row">
              <div class="form-group"><label>Password <span class="required">*</span></label>
                <input class="form-control" type="password" id="setup-pass" required minlength="6"></div>
              <div class="form-group"><label>Confirm Password <span class="required">*</span></label>
                <input class="form-control" type="password" id="setup-confirm" required></div>
            </div>
            <div class="form-group"><label>Security Question <span class="required">*</span></label>
              <select class="form-control" id="setup-sq" required>
                <option value="">Select…</option>
                <option>What is your mother's maiden name?</option>
                <option>What was the name of your first pet?</option>
                <option>What city were you born in?</option>
                <option>What is your favorite book?</option>
                <option>What was your first school name?</option>
              </select></div>
            <div class="form-group"><label>Security Answer <span class="required">*</span></label>
              <input class="form-control" id="setup-sa" required></div>
            <button type="submit" class="btn btn-primary w-full btn-lg" id="setup-btn">Create Admin Account</button>
          </form>
        </div>
      </div>
      <div id="toast-container" class="toast-container"></div>
      <div id="modal-overlay" class="modal-overlay"></div>`;
    document.getElementById('setup-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('setup-btn');
      btn.disabled = true;
      try {
        await Auth.createInitialAdmin({
          name: document.getElementById('setup-name').value,
          username: document.getElementById('setup-username').value,
          email: document.getElementById('setup-email').value,
          companyName: document.getElementById('setup-company').value,
          password: document.getElementById('setup-pass').value,
          confirmPassword: document.getElementById('setup-confirm').value,
          securityQuestion: document.getElementById('setup-sq').value,
          securityAnswer: document.getElementById('setup-sa').value
        });
        toast('Setup Complete', 'Administrator created. Please sign in.', 'success');
        showLogin();
      } catch (err) {
        toast('Setup Failed', err.message, 'error');
        btn.disabled = false;
      }
    };
  }

  /* ========== MAIN APP SHELL ========== */
  async function showApp() {
    const u = Auth.getCurrentUser();
    const companyName = await DB.getSetting('companyName', 'LeadFlow CRM');
    const theme = await DB.getSetting('theme', 'light');
    document.documentElement.setAttribute('data-theme', theme);

    document.getElementById('app').innerHTML = `
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <div class="app-layout">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <div class="logo-icon">📊</div>
            <div><h2>${Utils.escapeHtml(companyName)}</h2><span>LeadFlow CRM v${Utils.APP_VERSION}</span></div>
          </div>
          <nav class="sidebar-nav" id="sidebar-nav"></nav>
          <div class="sidebar-footer">
            <div class="user-info">
              <div class="user-avatar">${Utils.escapeHtml(Utils.getInitials(u.name))}</div>
              <div>
                <div class="user-name">${Utils.escapeHtml(u.name)}</div>
                <div class="user-role">${Utils.escapeHtml(u.role)}</div>
              </div>
            </div>
          </div>
        </aside>
        <div class="main-content">
          <header class="topbar">
            <button class="menu-toggle" id="menu-toggle" title="Menu">☰</button>
            <div class="topbar-search">
              <span class="search-icon">🔍</span>
              <input type="text" id="global-search" placeholder="Search leads, mobile, enquiry no…" autocomplete="off">
              <div class="search-results" id="search-results"></div>
            </div>
            <div class="topbar-actions">
              <button class="topbar-btn" id="theme-toggle" title="Toggle theme">🌓</button>
              <div style="position:relative">
                <button class="topbar-btn" id="notif-btn" title="Notifications">🔔<span class="notif-badge hidden" id="notif-badge">0</span></button>
                <div class="notif-dropdown" id="notif-dropdown"></div>
              </div>
              <button class="topbar-btn" id="logout-btn" title="Logout">⏻</button>
            </div>
          </header>
          <main class="page-content" id="page-content"></main>
        </div>
      </div>
      <div id="toast-container" class="toast-container"></div>
      <div id="modal-overlay" class="modal-overlay"></div>`;

    renderSidebar();
    bindShellEvents();
    await navigate('dashboard');
    await refreshNotifBadge();
    try { await Notifications.requestBrowserPermission(); } catch (_) {}
    await runReminderCheck(true);

    // Re-check reminders every 30 minutes while the app stays open
    clearInterval(window.__reminderTimer);
    window.__reminderTimer = setInterval(() => { runReminderCheck(false); }, 30 * 60 * 1000);
  }

  async function runReminderCheck(announce) {
    try {
      const r = await Notifications.checkDueReminders();
      await refreshNotifBadge();
      if (!announce) {
        if (currentPage === 'dashboard') navigate('dashboard');
        return r;
      }
      const counts = {
        fo: r.followupOverdue.length,
        ft: r.followupToday.length,
        fu: r.followupUpcoming.length,
        po: r.paymentOverdue.length,
        pt: r.paymentDueToday.length,
        ps: r.paymentDueSoon.length
      };
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total > 0) {
        const parts = [];
        if (counts.fo) parts.push(`${counts.fo} follow-up overdue`);
        if (counts.ft) parts.push(`${counts.ft} follow-up today`);
        if (counts.fu) parts.push(`${counts.fu} upcoming follow-up`);
        if (counts.po) parts.push(`${counts.po} payment overdue`);
        if (counts.pt) parts.push(`${counts.pt} payment due today`);
        if (counts.ps) parts.push(`${counts.ps} payment due soon`);
        toast('Reminders', parts.join(' · '), counts.fo || counts.po ? 'warning' : 'info');
      }
      return r;
    } catch (e) {
      console.error('Reminder check failed', e);
    }
  }

  function renderSidebar() {
    const u = Auth.getCurrentUser();
    const items = [
      { section: 'Main' },
      { id: 'dashboard', icon: '📈', label: 'Dashboard' },
      { id: 'leads', icon: '👥', label: 'Leads' },
      { id: 'payments', icon: '💰', label: 'Payments' },
      { id: 'followups', icon: '📅', label: 'Follow-ups', badge: 'fu' },
      { section: 'Insights' },
      { id: 'reports', icon: '📊', label: 'Reports', adminManager: true },
      { section: 'System' },
      { id: 'users', icon: '👤', label: 'Users', admin: true },
      { id: 'activity', icon: '📋', label: 'Activity Log', admin: true },
      { id: 'backup', icon: '💾', label: 'Backup & Restore', admin: true },
      { id: 'settings', icon: '⚙️', label: 'Settings' }
    ];

    let html = '';
    let sectionOpen = false;
    items.forEach(item => {
      if (item.section) {
        if (sectionOpen) html += '</div>';
        html += `<div class="nav-section"><div class="nav-section-title">${item.section}</div>`;
        sectionOpen = true;
        return;
      }
      if (item.admin && !Permissions.isAdmin()) return;
      if (item.adminManager && !Permissions.isManagerOrAdmin()) return;
      html += `<button class="nav-item ${currentPage === item.id ? 'active' : ''}" data-page="${item.id}">
        <span class="nav-icon">${item.icon}</span> ${item.label}
        ${item.badge ? `<span class="badge-count hidden" id="nav-badge-${item.badge}">0</span>` : ''}
      </button>`;
    });
    if (sectionOpen) html += '</div>';
    document.getElementById('sidebar-nav').innerHTML = html;
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.onclick = () => navigate(btn.dataset.page);
    });
  }

  function bindShellEvents() {
    document.getElementById('menu-toggle').onclick = () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('show');
    };
    document.getElementById('sidebar-overlay').onclick = () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    };
    document.getElementById('logout-btn').onclick = async () => {
      if (await confirm('Logout', 'Are you sure you want to logout?')) {
        await Auth.logout();
        showLogin();
        toast('Logged out', 'See you next time', 'info');
      }
    };
    document.getElementById('theme-toggle').onclick = async () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      await DB.setSetting('theme', next);
    };
    document.getElementById('notif-btn').onclick = (e) => {
      e.stopPropagation();
      toggleNotifDropdown();
    };
    document.addEventListener('click', () => {
      document.getElementById('notif-dropdown')?.classList.remove('show');
      document.getElementById('search-results')?.classList.remove('show');
    });

    const searchInput = document.getElementById('global-search');
    searchInput.addEventListener('input', Utils.debounce(async () => {
      const q = searchInput.value.trim();
      const box = document.getElementById('search-results');
      if (q.length < 2) { box.classList.remove('show'); return; }
      const results = await Leads.globalSearch(q);
      if (!results.length) {
        box.innerHTML = '<div class="search-result-item text-muted">No results found</div>';
        box.classList.add('show');
        return;
      }
      if (results.length === 1 && results[0].type === 'lead') {
        // Convenient direct open hint
      }
      box.innerHTML = results.map(r => `
        <div class="search-result-item" data-lead="${r.leadId}">
          <div class="sr-title">${Utils.escapeHtml(r.title)}</div>
          <div class="sr-meta">${Utils.escapeHtml(r.meta)} · ${r.type}</div>
        </div>`).join('');
      box.classList.add('show');
      box.querySelectorAll('[data-lead]').forEach(el => {
        el.onclick = () => {
          box.classList.remove('show');
          searchInput.value = '';
          viewLead(el.dataset.lead);
        };
      });
    }, 250));

    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (q.length < 2) return;
        const results = await Leads.globalSearch(q);
        if (results.length === 1) {
          viewLead(results[0].leadId);
          searchInput.value = '';
          document.getElementById('search-results').classList.remove('show');
        }
      }
    });
  }

  async function refreshNotifBadge() {
    const u = Auth.getCurrentUser();
    if (!u) return;
    const count = await Notifications.getUnreadCount(u.id);
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.toggle('hidden', count === 0);
    }
  }

  async function toggleNotifDropdown() {
    const dd = document.getElementById('notif-dropdown');
    if (dd.classList.contains('show')) { dd.classList.remove('show'); return; }
    const u = Auth.getCurrentUser();
    const items = await Notifications.getForUser(u.id);
    dd.innerHTML = `
      <div class="notif-dropdown-header">
        <span>Notifications</span>
        <button class="btn btn-ghost btn-sm" id="mark-all-read">Mark all read</button>
      </div>
      <div class="notif-list">
        ${items.length === 0 ? '<div class="empty-state" style="padding:1.5rem"><p>No notifications</p></div>' :
          items.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-lead="${n.leadId || ''}">
              <div class="notif-title">${Utils.escapeHtml(n.title)}</div>
              <div class="notif-msg">${Utils.escapeHtml(n.message)}</div>
              <div class="notif-time">${Utils.relativeTime(n.createdAt)}</div>
            </div>`).join('')}
      </div>`;
    dd.classList.add('show');
    document.getElementById('mark-all-read')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await Notifications.markAllRead(u.id);
      await refreshNotifBadge();
      dd.classList.remove('show');
    });
    dd.querySelectorAll('.notif-item').forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        await Notifications.markRead(el.dataset.id);
        await refreshNotifBadge();
        dd.classList.remove('show');
        if (el.dataset.lead) viewLead(el.dataset.lead);
      };
    });
  }

  async function navigate(page, params = {}) {
    currentPage = page;
    currentLeadId = params.leadId || null;
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('show');
    renderSidebar();
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading…</div>';
    try {
      switch (page) {
        case 'dashboard': await renderDashboard(content); break;
        case 'leads': await renderLeadsList(content); break;
        case 'lead-detail': await renderLeadDetail(content, params.leadId); break;
        case 'lead-new': await renderLeadForm(content); break;
        case 'lead-edit': await renderLeadForm(content, params.leadId); break;
        case 'payments': await renderPayments(content); break;
        case 'followups': await renderFollowups(content); break;
        case 'reports': await renderReports(content); break;
        case 'users': await renderUsers(content); break;
        case 'activity': await renderActivity(content); break;
        case 'backup': await renderBackup(content); break;
        case 'settings': await renderSettings(content); break;
        default: await renderDashboard(content);
      }
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Error</h3><p>${Utils.escapeHtml(e.message)}</p>
        <button class="btn btn-primary" onclick="App.navigate('dashboard')">Go to Dashboard</button></div>`;
    }
  }

  function onSessionTimeout() {
    showLogin();
    toast('Session Expired', 'You have been logged out due to inactivity.', 'warning');
  }

  function renderRemindersHtml(r) {
    const payItems = [
      ...r.paymentOverdue.map(x => ({ ...x, kind: 'Overdue', cls: 'badge-overdue', sort: 0 })),
      ...r.paymentDueToday.map(x => ({ ...x, kind: 'Due Today', cls: 'badge-due', sort: 1 })),
      ...r.paymentDueSoon.map(x => ({ ...x, kind: 'Due Soon', cls: 'badge-pending', sort: 2 }))
    ];
    const fuItems = [
      ...r.followupOverdue.map(x => ({ ...x, kind: 'Overdue', cls: 'badge-overdue', sort: 0 })),
      ...r.followupToday.map(x => ({ ...x, kind: 'Today', cls: 'badge-due', sort: 1 })),
      ...r.followupUpcoming.map(x => ({ ...x, kind: 'Upcoming', cls: 'badge-pending', sort: 2 }))
    ];

    if (!payItems.length && !fuItems.length) return '';

    const payRows = payItems.map(p => `
      <div class="reminder-row">
        <div class="reminder-info">
          <div class="reminder-title">
            <a href="#" data-view="${p.lead.id}">${Utils.escapeHtml(p.lead.enquiryNo)} — ${Utils.escapeHtml(p.lead.customerName)}</a>
            <span class="badge ${p.cls}">${p.kind}${p.daysOverdue ? ' ' + p.daysOverdue + 'd' : p.daysLeft ? ' in ' + p.daysLeft + 'd' : ''}</span>
          </div>
          <div class="reminder-meta">
            <strong class="currency">${Utils.formatCurrency(p.fin.pendingAmount)}</strong> pending
            ${p.lead.nextPaymentDueDate ? '· due ' + Utils.formatDate(p.lead.nextPaymentDueDate) : ''}
            · ${Utils.escapeHtml(p.lead.mobile || 'no mobile')}
          </div>
        </div>
        <div class="reminder-actions">
          ${p.lead.mobile ? `<button class="btn btn-success btn-sm" data-wa-pay="${p.lead.id}">WhatsApp</button>` : '<span class="form-hint">No mobile</span>'}
        </div>
      </div>`).join('');

    const fuRows = fuItems.map(f => `
      <div class="reminder-row">
        <div class="reminder-info">
          <div class="reminder-title">
            <a href="#" data-view="${f.lead.id}">${Utils.escapeHtml(f.lead.enquiryNo)} — ${Utils.escapeHtml(f.lead.customerName)}</a>
            <span class="badge ${f.cls}">${f.kind}${f.daysLeft ? ' in ' + f.daysLeft + 'd' : ''}</span>
          </div>
          <div class="reminder-meta">
            ${Utils.formatDate(f.followup.date)} ${f.followup.time ? Utils.escapeHtml(f.followup.time) : ''}
            ${f.followup.notes ? '· ' + Utils.escapeHtml(f.followup.notes.slice(0, 80)) : ''}
          </div>
        </div>
        <div class="reminder-actions">
          ${f.lead.mobile ? `<button class="btn btn-success btn-sm" data-wa-fu="${f.followup.id}">WhatsApp</button>` : ''}
          ${f.followup.status !== 'Completed' ? `<button class="btn btn-outline btn-sm" data-rem-complete="${f.followup.id}">Complete</button>` : ''}
        </div>
      </div>`).join('');

    return `
      <div class="charts-grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
        ${payItems.length ? `
        <div class="card">
          <div class="card-header"><h3>💰 Payment Reminders (${payItems.length})</h3></div>
          <div class="card-body" style="padding:0.5rem">${payRows}</div>
        </div>` : ''}
        ${fuItems.length ? `
        <div class="card">
          <div class="card-header"><h3>📅 Follow-up Reminders (${fuItems.length})</h3></div>
          <div class="card-body" style="padding:0.5rem">${fuRows}</div>
        </div>` : ''}
      </div>`;
  }

  async function sendPaymentWhatsapp(leadId) {
    const lead = await Leads.getById(leadId);
    if (!lead) return;
    const fin = await Leads.getFinancials(leadId);
    if (fin.pendingAmount <= 0) {
      toast('No Pending Amount', 'This lead has no pending payment.', 'info');
      return;
    }
    if (!lead.mobile) {
      toast('No Mobile Number', 'Add a client mobile number to send WhatsApp reminders.', 'error');
      return;
    }
    const msg = await Utils.paymentReminderMessage(lead, fin);
    Audit.logCurrent('Updated', `Payment reminder opened on WhatsApp for ${lead.enquiryNo} (${Utils.formatCurrency(fin.pendingAmount)})`, leadId);
    const ok = Utils.openWhatsapp(lead.mobile, msg);
    if (ok) toast('WhatsApp', 'Opening WhatsApp with the payment reminder…', 'success');
  }

  async function sendFollowupWhatsapp(followupId) {
    const f = await DB.get('followups', followupId);
    if (!f) return;
    const lead = await Leads.getById(f.leadId);
    if (!lead.mobile) {
      toast('No Mobile Number', 'Add a client mobile number to send WhatsApp messages.', 'error');
      return;
    }
    const msg = Utils.followupReminderMessage(lead, f);
    Audit.logCurrent('Updated', `Follow-up reminder opened on WhatsApp for ${lead.enquiryNo}`, lead.id);
    Utils.openWhatsapp(lead.mobile, msg);
    toast('WhatsApp', 'Opening WhatsApp with the follow-up message…', 'success');
  }

  /* ========== DASHBOARD ========== */
  async function renderDashboard(el) {
    const kpis = await Reports.getDashboardKPIs();
    const trend = await Reports.getLeadTrend(6);
    const payTrend = await Reports.getPaymentCollection(6);
    const execPerf = Permissions.isManagerOrAdmin() ? await Reports.getExecutivePerformance() : [];
    const reminders = await Notifications.getReminders();

    const maxTrend = Math.max(...trend.map(t => t.count), 1);
    const maxPay = Math.max(...payTrend.map(t => t.total), 1);

    const statusColors = {
      'New': '#3b82f6', 'Open': '#6366f1', 'In Progress': '#f59e0b',
      'On Hold': '#a855f7', 'Won': '#22c55e', 'Lost': '#ef4444'
    };
    const statusEntries = Object.entries(kpis.byStatus);
    const totalS = statusEntries.reduce((s, [, v]) => s + v, 0) || 1;
    let gradientParts = [];
    let acc = 0;
    statusEntries.forEach(([status, count]) => {
      const pct = (count / totalS) * 100;
      gradientParts.push(`${statusColors[status] || '#94a3b8'} ${acc}% ${acc + pct}%`);
      acc += pct;
    });

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Dashboard</h1><div class="subtitle">Welcome back, ${Utils.escapeHtml(Auth.getCurrentUser().name)}</div></div>
        <div class="page-actions">
          <button class="btn btn-primary" id="dash-new-lead">+ New Lead</button>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card kpi-blue"><div class="kpi-label">Total Leads</div><div class="kpi-value">${kpis.totalLeads}</div></div>
        <div class="kpi-card"><div class="kpi-label">New</div><div class="kpi-value">${kpis.new}</div></div>
        <div class="kpi-card kpi-cyan"><div class="kpi-label">Open</div><div class="kpi-value">${kpis.open}</div></div>
        <div class="kpi-card kpi-orange"><div class="kpi-label">In Progress</div><div class="kpi-value">${kpis.inProgress}</div></div>
        <div class="kpi-card kpi-purple"><div class="kpi-label">On Hold</div><div class="kpi-value">${kpis.onHold}</div></div>
        <div class="kpi-card kpi-green"><div class="kpi-label">Won</div><div class="kpi-value">${kpis.won}</div></div>
        <div class="kpi-card kpi-red"><div class="kpi-label">Lost</div><div class="kpi-value">${kpis.lost}</div></div>
        <div class="kpi-card kpi-green"><div class="kpi-label">Conversion</div><div class="kpi-value">${kpis.conversionRate}%</div></div>
        <div class="kpi-card kpi-blue"><div class="kpi-label">Deal Value</div><div class="kpi-value" style="font-size:1.2rem">${Utils.formatCurrency(kpis.totalDealValue)}</div></div>
        <div class="kpi-card kpi-green"><div class="kpi-label">Received</div><div class="kpi-value" style="font-size:1.2rem">${Utils.formatCurrency(kpis.totalReceived)}</div></div>
        <div class="kpi-card kpi-orange"><div class="kpi-label">Pending</div><div class="kpi-value" style="font-size:1.2rem">${Utils.formatCurrency(kpis.totalPending)}</div></div>
        <div class="kpi-card kpi-red"><div class="kpi-label">Overdue Payments</div><div class="kpi-value">${kpis.overduePayments}</div></div>
        <div class="kpi-card kpi-cyan"><div class="kpi-label">Upcoming Follow-ups</div><div class="kpi-value">${kpis.upcomingFollowups}</div></div>
        <div class="kpi-card kpi-red"><div class="kpi-label">Overdue Follow-ups</div><div class="kpi-value">${kpis.overdueFollowups}</div></div>
      </div>

      ${renderRemindersHtml(reminders)}

      ${kpis.totalLeads === 0 ? `
        <div class="card"><div class="empty-state">
          <div class="empty-icon">📭</div>
          <h3>No leads yet</h3>
          <p>Get started by creating your first lead.</p>
          <button class="btn btn-primary" id="dash-empty-new">+ New Lead</button>
        </div></div>` : `
      <div class="charts-grid">
        <div class="card">
          <div class="card-header"><h3>Lead Trend (6 months)</h3></div>
          <div class="card-body"><div class="chart-bar-group">
            ${trend.map(t => `
              <div class="chart-bar-col">
                <div class="bar-value">${t.count || ''}</div>
                <div class="chart-bar" style="height:${Math.max(2, (t.count / maxTrend) * 100)}%"></div>
                <div class="bar-label">${Utils.escapeHtml(t.label)}</div>
              </div>`).join('')}
          </div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Status Distribution</h3></div>
          <div class="card-body">
            <div class="pie-chart">
              <div class="pie-visual" style="background:conic-gradient(${gradientParts.join(',') || '#e2e8f0 0% 100%'})"></div>
              <div class="pie-legend">
                ${statusEntries.map(([s, c]) => `
                  <div class="pie-legend-item">
                    <span class="pie-dot" style="background:${statusColors[s]}"></span>
                    ${Utils.escapeHtml(s)}: <strong>${c}</strong>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Won vs Lost</h3></div>
          <div class="card-body">
            <div class="pie-chart">
              <div class="pie-visual" style="background:conic-gradient(
                #22c55e 0% ${(kpis.won / (kpis.won + kpis.lost || 1)) * 100}%,
                #ef4444 ${(kpis.won / (kpis.won + kpis.lost || 1)) * 100}% 100%)"></div>
              <div class="pie-legend">
                <div class="pie-legend-item"><span class="pie-dot" style="background:#22c55e"></span>Won: <strong>${kpis.won}</strong></div>
                <div class="pie-legend-item"><span class="pie-dot" style="background:#ef4444"></span>Lost: <strong>${kpis.lost}</strong></div>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Payment Collection</h3></div>
          <div class="card-body"><div class="chart-bar-group">
            ${payTrend.map(t => `
              <div class="chart-bar-col">
                <div class="bar-value" style="font-size:0.6rem">${t.total ? Utils.formatCurrency(t.total) : ''}</div>
                <div class="chart-bar" style="height:${Math.max(2, (t.total / maxPay) * 100)}%;background:var(--success)"></div>
                <div class="bar-label">${Utils.escapeHtml(t.label)}</div>
              </div>`).join('')}
          </div></div>
        </div>
      </div>

      ${execPerf.length ? `
      <div class="card mt-2">
        <div class="card-header"><h3>Executive Performance</h3></div>
        <div class="card-body table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Role</th><th>Leads</th><th>Active</th><th>Won</th><th>Lost</th><th>Deal Value</th></tr></thead>
            <tbody>
              ${execPerf.map(e => `<tr>
                <td>${Utils.escapeHtml(e.name)}</td>
                <td>${Utils.badge(e.role)}</td>
                <td>${e.totalLeads}</td><td>${e.active}</td><td>${e.won}</td><td>${e.lost}</td>
                <td class="currency">${Utils.formatCurrency(e.dealValue)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}`}
    `;
    document.getElementById('dash-new-lead')?.addEventListener('click', () => navigate('lead-new'));
    document.getElementById('dash-empty-new')?.addEventListener('click', () => navigate('lead-new'));

    el.querySelectorAll('[data-wa-pay]').forEach(b => b.onclick = () => sendPaymentWhatsapp(b.dataset.waPay));
    el.querySelectorAll('[data-wa-fu]').forEach(b => b.onclick = () => sendFollowupWhatsapp(b.dataset.waFu));
    el.querySelectorAll('[data-rem-complete]').forEach(b => b.onclick = async () => {
      try {
        await Followups.complete(b.dataset.remComplete);
        toast('Completed', 'Follow-up marked complete', 'success');
        navigate('dashboard');
      } catch (err) { toast('Error', err.message, 'error'); }
    });
    el.querySelectorAll('.reminder-title a[data-view]').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); viewLead(a.dataset.view); };
    });
  }

  /* ========== LEADS LIST ========== */
  async function renderLeadsList(el) {
    const users = await DB.getAll('users');
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    let leads = await Leads.getAll();

    // Enrich with financials
    const enriched = [];
    for (const l of leads) {
      const fin = await Leads.getFinancials(l.id);
      enriched.push({ ...l, ...fin, assigneeName: userMap[l.assignedTo] || '—' });
    }
    leads = enriched;

    const f = leadListState.filters;
    if (f.search) {
      const q = f.search.toLowerCase();
      leads = leads.filter(l =>
        (l.enquiryNo || '').toLowerCase().includes(q) ||
        (l.customerName || '').toLowerCase().includes(q) ||
        (l.mobile || '').includes(q) ||
        (l.companyName || '').toLowerCase().includes(q)
      );
    }
    if (f.status) leads = leads.filter(l => l.status === f.status);
    if (f.assignedTo) leads = leads.filter(l => l.assignedTo === f.assignedTo);
    if (f.source) leads = leads.filter(l => l.source === f.source);
    if (f.paymentStatus) leads = leads.filter(l => l.paymentStatus === f.paymentStatus);
    if (f.dateFrom) leads = leads.filter(l => l.enquiryDate >= f.dateFrom);
    if (f.dateTo) leads = leads.filter(l => l.enquiryDate <= f.dateTo);

    // Sort
    const { sort, sortDir } = leadListState;
    leads.sort((a, b) => {
      let va = a[sort], vb = b[sort];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const total = leads.length;
    const pages = Math.max(1, Math.ceil(total / leadListState.perPage));
    if (leadListState.page > pages) leadListState.page = pages;
    const start = (leadListState.page - 1) * leadListState.perPage;
    const pageLeads = leads.slice(start, start + leadListState.perPage);

    const assignOpts = users.filter(u => u.active).map(u =>
      `<option value="${u.id}" ${f.assignedTo === u.id ? 'selected' : ''}>${Utils.escapeHtml(u.name)}</option>`).join('');

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Leads</h1><div class="subtitle">${total} lead${total !== 1 ? 's' : ''}</div></div>
        <div class="page-actions">
          <button class="btn btn-primary" id="btn-new-lead">+ New Lead</button>
        </div>
      </div>
      <div class="filters-bar">
        <input class="form-control search-input" id="f-search" placeholder="Search…" value="${Utils.escapeHtml(f.search || '')}">
        <select class="form-control" id="f-status">
          <option value="">All Statuses</option>
          ${Leads.STATUSES.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        ${Permissions.canViewAllLeads() ? `<select class="form-control" id="f-assigned"><option value="">All Assignees</option>${assignOpts}</select>` : ''}
        <select class="form-control" id="f-source">
          <option value="">All Sources</option>
          ${Leads.SOURCES.map(s => `<option value="${s}" ${f.source === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select class="form-control" id="f-paystatus">
          <option value="">All Payment Status</option>
          ${['Not Applicable','Pending','Partially Paid','Paid','Due','Overdue'].map(s =>
            `<option value="${s}" ${f.paymentStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <input type="date" class="form-control" id="f-from" value="${f.dateFrom || ''}" title="From">
        <input type="date" class="form-control" id="f-to" value="${f.dateTo || ''}" title="To">
        <button class="btn btn-outline btn-sm" id="f-clear">Clear</button>
      </div>
      <div class="card">
        <div class="table-wrap table-desktop">
          <table class="data-table">
            <thead><tr>
              ${[['enquiryNo','Enquiry No'],['enquiryDate','Date'],['customerName','Customer'],['companyName','Company'],
                ['mobile','Mobile'],['source','Source'],['enquiryType','Type'],['assigneeName','Assigned'],
                ['offerAmount','Offer'],['dealCloseAmount','Close Amt'],['totalReceived','Received'],
                ['pendingAmount','Pending'],['paymentStatus','Pay Status'],['status','Status'],['updatedAt','Updated']
              ].map(([k, l]) => `<th data-sort="${k}" class="${sort === k ? 'sorted' : ''}">${l}<span class="sort-icon">${sort === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span></th>`).join('')}
              <th>Actions</th>
            </tr></thead>
            <tbody>
              ${pageLeads.length === 0 ? `<tr><td colspan="16"><div class="empty-state"><div class="empty-icon">📭</div><h3>No leads found</h3><p>Create a new lead or adjust filters.</p></div></td></tr>` :
                pageLeads.map(l => `
                <tr>
                  <td class="font-mono"><a href="#" data-view="${l.id}">${Utils.escapeHtml(l.enquiryNo)}</a></td>
                  <td>${Utils.formatDate(l.enquiryDate)}</td>
                  <td>${Utils.escapeHtml(l.customerName)}</td>
                  <td>${Utils.escapeHtml(l.companyName || '—')}</td>
                  <td>${Utils.escapeHtml(l.mobile)}</td>
                  <td>${Utils.escapeHtml(l.source || '—')}</td>
                  <td>${Utils.escapeHtml(l.enquiryType || '—')}</td>
                  <td>${Utils.escapeHtml(l.assigneeName)}</td>
                  <td class="currency">${l.offerAmount != null ? Utils.formatCurrency(l.offerAmount) : '—'}</td>
                  <td class="currency">${l.dealCloseAmount != null ? Utils.formatCurrency(l.dealCloseAmount) : '—'}</td>
                  <td class="currency">${Utils.formatCurrency(l.totalReceived)}</td>
                  <td class="currency font-bold">${Utils.formatCurrency(l.pendingAmount)}</td>
                  <td>${Utils.badge(l.paymentStatus)}</td>
                  <td>${Utils.badge(l.status)}</td>
                  <td>${Utils.formatDate(l.updatedAt)}</td>
                  <td class="actions-cell">${leadActionButtons(l)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="lead-cards">
          ${pageLeads.length === 0 ? '<div class="empty-state"><h3>No leads found</h3></div>' :
            pageLeads.map(l => `
            <div class="lead-card-item">
              <div class="lc-header">
                <div><div class="lc-title">${Utils.escapeHtml(l.customerName)}</div>
                <div class="lc-enq">${Utils.escapeHtml(l.enquiryNo)} · ${Utils.formatDate(l.enquiryDate)}</div></div>
                ${Utils.badge(l.status)}
              </div>
              <div class="lc-grid">
                <div><span class="lc-label">Mobile</span><br>${Utils.escapeHtml(l.mobile)}</div>
                <div><span class="lc-label">Company</span><br>${Utils.escapeHtml(l.companyName || '—')}</div>
                <div><span class="lc-label">Pending</span><br class="currency">${Utils.formatCurrency(l.pendingAmount)}</div>
                <div><span class="lc-label">Payment</span><br>${Utils.badge(l.paymentStatus)}</div>
              </div>
              <div class="lc-actions">${leadActionButtons(l)}</div>
            </div>`).join('')}
        </div>
        <div class="card-footer">
          <div class="pagination">
            <span>Showing ${total === 0 ? 0 : start + 1}–${Math.min(start + leadListState.perPage, total)} of ${total}</span>
            <div class="pagination-btns">
              <button ${leadListState.page <= 1 ? 'disabled' : ''} data-pg="${leadListState.page - 1}">Prev</button>
              ${Array.from({ length: pages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === pages || Math.abs(p - leadListState.page) <= 2)
                .map((p, i, arr) => {
                  const dots = i > 0 && p - arr[i - 1] > 1 ? '<span>…</span>' : '';
                  return dots + `<button class="${p === leadListState.page ? 'active' : ''}" data-pg="${p}">${p}</button>`;
                }).join('')}
              <button ${leadListState.page >= pages ? 'disabled' : ''} data-pg="${leadListState.page + 1}">Next</button>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('btn-new-lead').onclick = () => navigate('lead-new');
    const applyFilters = () => {
      leadListState.filters = {
        search: document.getElementById('f-search')?.value || '',
        status: document.getElementById('f-status')?.value || '',
        assignedTo: document.getElementById('f-assigned')?.value || '',
        source: document.getElementById('f-source')?.value || '',
        paymentStatus: document.getElementById('f-paystatus')?.value || '',
        dateFrom: document.getElementById('f-from')?.value || '',
        dateTo: document.getElementById('f-to')?.value || ''
      };
      leadListState.page = 1;
      navigate('leads');
    };
    ['f-status', 'f-assigned', 'f-source', 'f-paystatus', 'f-from', 'f-to'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', applyFilters);
    });
    document.getElementById('f-search')?.addEventListener('input', Utils.debounce(applyFilters, 300));
    document.getElementById('f-clear')?.addEventListener('click', () => {
      leadListState.filters = {};
      leadListState.page = 1;
      navigate('leads');
    });
    el.querySelectorAll('[data-sort]').forEach(th => {
      th.onclick = () => {
        if (leadListState.sort === th.dataset.sort) {
          leadListState.sortDir = leadListState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          leadListState.sort = th.dataset.sort;
          leadListState.sortDir = 'desc';
        }
        navigate('leads');
      };
    });
    el.querySelectorAll('[data-pg]').forEach(btn => {
      btn.onclick = () => { leadListState.page = Number(btn.dataset.pg); navigate('leads'); };
    });
    bindLeadActions(el);
  }

  function leadActionButtons(l) {
    const locked = Permissions.isLeadLocked(l);
    let btns = `<button class="btn btn-outline btn-sm" data-view="${l.id}">View</button>`;
    if (!locked && Permissions.canEditLead(l)) {
      btns += `<button class="btn btn-outline btn-sm" data-edit="${l.id}">Edit</button>`;
      btns += `<button class="btn btn-primary btn-sm" data-status="${l.id}">Status</button>`;
    }
    if (locked) {
      btns += `<button class="btn btn-outline btn-sm" data-view="${l.id}" data-tab="payments">Payments</button>`;
      btns += `<button class="btn btn-outline btn-sm" data-view="${l.id}" data-tab="documents">Docs</button>`;
    }
    if (!locked && Permissions.canDeleteLead(l)) {
      btns += `<button class="btn btn-danger btn-sm" data-delete="${l.id}">Delete</button>`;
    }
    return btns;
  }

  function bindLeadActions(el) {
    el.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); viewLead(b.dataset.view, b.dataset.tab); };
    });
    el.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => navigate('lead-edit', { leadId: b.dataset.edit });
    });
    el.querySelectorAll('[data-status]').forEach(b => {
      b.onclick = () => showStatusModal(b.dataset.status);
    });
    el.querySelectorAll('[data-delete]').forEach(b => {
      b.onclick = async () => {
        if (await confirm('Delete Lead', 'Delete this lead and all related payments, documents, and follow-ups?', 'This cannot be undone.')) {
          try {
            await Leads.remove(b.dataset.delete);
            toast('Deleted', 'Lead deleted successfully', 'success');
            navigate('leads');
          } catch (err) { toast('Error', err.message, 'error'); }
        }
      };
    });
  }

  function viewLead(id, tab) {
    window._leadTab = tab || 'overview';
    navigate('lead-detail', { leadId: id, tab });
  }

  /* ========== LEAD FORM ========== */
  async function renderLeadForm(el, editId) {
    const isEdit = !!editId;
    let lead = null;
    if (isEdit) {
      lead = await Leads.getById(editId);
      if (Permissions.isLeadLocked(lead)) {
        toast('Locked', 'This lead is permanently locked and cannot be edited.', 'error');
        return viewLead(editId);
      }
      if (!Permissions.canEditLead(lead)) throw new Error('Permission denied.');
    }

    const users = (await DB.getAll('users')).filter(u => u.active);
    const canAssign = Permissions.isManagerOrAdmin();

    el.innerHTML = `
      <div class="page-header">
        <div><h1>${isEdit ? 'Edit Lead' : 'New Lead'}</h1>
        <div class="subtitle">${isEdit ? Utils.escapeHtml(lead.enquiryNo) : 'Create a new enquiry'}</div></div>
        <div class="page-actions">
          <button class="btn btn-outline" id="btn-cancel">Cancel</button>
        </div>
      </div>
      <form id="lead-form" class="card">
        <div class="card-body">
          ${isEdit ? `<div class="form-group"><label>Enquiry Number</label>
            <input class="form-control" value="${Utils.escapeHtml(lead.enquiryNo)}" readonly></div>` : ''}
          <div class="form-row">
            <div class="form-group"><label>Enquiry Date <span class="required">*</span></label>
              <input type="date" class="form-control" id="lf-date" required value="${lead?.enquiryDate || Utils.today()}"></div>
            <div class="form-group"><label>Customer Name <span class="required">*</span></label>
              <input class="form-control" id="lf-name" required value="${Utils.escapeHtml(lead?.customerName || '')}"></div>
            <div class="form-group"><label>Mobile Number <span class="required">*</span></label>
              <input class="form-control" id="lf-mobile" required pattern="[6-9]\\d{9}" maxlength="10"
                value="${Utils.escapeHtml(lead?.mobile || '')}" placeholder="10-digit mobile"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Company Name</label>
              <input class="form-control" id="lf-company" value="${Utils.escapeHtml(lead?.companyName || '')}"></div>
            <div class="form-group"><label>Alternate Mobile</label>
              <input class="form-control" id="lf-altmobile" maxlength="15" value="${Utils.escapeHtml(lead?.alternateMobile || '')}"></div>
            <div class="form-group"><label>Email</label>
              <input type="email" class="form-control" id="lf-email" value="${Utils.escapeHtml(lead?.email || '')}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>City</label>
              <input class="form-control" id="lf-city" value="${Utils.escapeHtml(lead?.city || '')}"></div>
            <div class="form-group"><label>State</label>
              <input class="form-control" id="lf-state" value="${Utils.escapeHtml(lead?.state || '')}"></div>
            <div class="form-group"><label>Source</label>
              <select class="form-control" id="lf-source">
                <option value="">Select…</option>
                ${Leads.SOURCES.map(s => `<option value="${s}" ${lead?.source === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select></div>
            <div class="form-group"><label>Enquiry Type</label>
              <select class="form-control" id="lf-type">
                <option value="">Select…</option>
                ${Leads.ENQUIRY_TYPES.map(s => `<option value="${s}" ${lead?.enquiryType === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select></div>
          </div>
          ${canAssign ? `<div class="form-group"><label>Assigned To</label>
            <select class="form-control" id="lf-assigned">
              ${users.map(u => `<option value="${u.id}" ${(lead?.assignedTo || Auth.getCurrentUser().id) === u.id ? 'selected' : ''}>${Utils.escapeHtml(u.name)} (${u.role})</option>`).join('')}
            </select></div>` : ''}
          <div class="form-group"><label>Requirements / Description</label>
            <textarea class="form-control" id="lf-req" rows="3">${Utils.escapeHtml(lead?.requirements || '')}</textarea></div>

          <div class="financial-box">
            <h4>💰 Financial Details</h4>
            <div class="form-row">
              <div class="form-group"><label>Offer Amount (₹)</label>
                <input type="number" class="form-control" id="lf-offer" min="0" step="0.01" value="${lead?.offerAmount ?? ''}"></div>
              <div class="form-group"><label>Total Deal Value (₹)</label>
                <input type="number" class="form-control" id="lf-dealvalue" min="0" step="0.01" value="${lead?.totalDealValue ?? ''}">
                <div class="form-hint">Used for payment tracking if set</div></div>
              <div class="form-group"><label>Next Payment Due Date</label>
                <input type="date" class="form-control" id="lf-duedate" value="${lead?.nextPaymentDueDate || ''}"></div>
              <div class="form-group"><label>Due Amount (₹)</label>
                <input type="number" class="form-control" id="lf-dueamt" min="0" step="0.01" value="${lead?.dueAmount ?? ''}"></div>
            </div>
          </div>

          ${!isEdit ? `
          <div class="form-group"><label>Attachments</label>
            <div class="file-drop" id="lf-drop">
              <p>📎 Drop files here or click to browse</p>
              <p class="form-hint">PDF, DOC, XLS, JPG, PNG, ZIP</p>
              <input type="file" id="lf-files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip" hidden>
            </div>
            <div class="file-list" id="lf-file-list"></div>
          </div>` : ''}
        </div>
        <div class="card-footer" style="display:flex;justify-content:flex-end;gap:0.5rem">
          <button type="button" class="btn btn-outline" id="btn-cancel2">Cancel</button>
          <button type="submit" class="btn btn-primary" id="lf-submit">${isEdit ? 'Save Changes' : 'Create Lead'}</button>
        </div>
      </form>`;

    document.getElementById('btn-cancel').onclick = () => isEdit ? viewLead(editId) : navigate('leads');
    document.getElementById('btn-cancel2').onclick = () => isEdit ? viewLead(editId) : navigate('leads');

    let pendingFiles = [];
    if (!isEdit) {
      const drop = document.getElementById('lf-drop');
      const fileInput = document.getElementById('lf-files');
      drop.onclick = () => fileInput.click();
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragover'); };
      drop.ondragleave = () => drop.classList.remove('dragover');
      drop.ondrop = (e) => {
        e.preventDefault();
        drop.classList.remove('dragover');
        addFiles(e.dataTransfer.files);
      };
      fileInput.onchange = () => addFiles(fileInput.files);
      function renderPendingFiles() {
        document.getElementById('lf-file-list').innerHTML = pendingFiles.map((f, i) =>
          `<div class="file-item"><span class="file-icon">📄</span>
            <div class="file-info"><div class="file-name">${Utils.escapeHtml(f.name)}</div>
            <div class="file-meta">${Utils.formatFileSize(f.size)}</div></div>
            <button type="button" class="btn btn-ghost btn-sm" data-rm="${i}">×</button></div>`
        ).join('');
        document.querySelectorAll('[data-rm]').forEach(b => {
          b.onclick = () => { pendingFiles.splice(+b.dataset.rm, 1); renderPendingFiles(); };
        });
      }
      function addFiles(files) {
        [...files].forEach(f => pendingFiles.push(f));
        renderPendingFiles();
      }
    }

    document.getElementById('lead-form').onsubmit = async (e) => {
      e.preventDefault();
      if (submitting) return;
      submitting = true;
      const btn = document.getElementById('lf-submit');
      btn.disabled = true;
      try {
        const data = {
          enquiryDate: document.getElementById('lf-date').value,
          customerName: document.getElementById('lf-name').value,
          mobile: document.getElementById('lf-mobile').value,
          companyName: document.getElementById('lf-company').value,
          alternateMobile: document.getElementById('lf-altmobile').value,
          email: document.getElementById('lf-email').value,
          city: document.getElementById('lf-city').value,
          state: document.getElementById('lf-state').value,
          source: document.getElementById('lf-source').value,
          enquiryType: document.getElementById('lf-type').value,
          requirements: document.getElementById('lf-req').value,
          offerAmount: document.getElementById('lf-offer').value,
          totalDealValue: document.getElementById('lf-dealvalue').value,
          nextPaymentDueDate: document.getElementById('lf-duedate').value,
          dueAmount: document.getElementById('lf-dueamt').value
        };
        const assignEl = document.getElementById('lf-assigned');
        if (assignEl) data.assignedTo = assignEl.value;

        let result;
        if (isEdit) {
          result = await Leads.update(editId, data);
          toast('Updated', `Lead ${result.enquiryNo} updated`, 'success');
        } else {
          result = await Leads.create(data);
          for (const file of pendingFiles) {
            try { await Attachments.upload({ file, leadId: result.id }); } catch (fe) {
              toast('Attachment Warning', fe.message, 'warning');
            }
          }
          toast('Created', `Lead ${result.enquiryNo} created successfully`, 'success');
        }
        viewLead(result.id);
      } catch (err) {
        toast('Error', err.message, 'error');
        btn.disabled = false;
      } finally {
        submitting = false;
      }
    };
  }

  /* ========== LEAD DETAIL ========== */
  async function renderLeadDetail(el, leadId) {
    const lead = await Leads.getById(leadId);
    const fin = await Leads.getFinancials(leadId);
    const users = await DB.getAll('users');
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    const locked = Permissions.isLeadLocked(lead);
    const startTab = window._leadTab || 'overview';
    window._leadTab = 'overview';

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>${Utils.escapeHtml(lead.customerName)}
            ${Utils.badge(lead.status)}
          </h1>
          <div class="subtitle font-mono">${Utils.escapeHtml(lead.enquiryNo)} · ${Utils.formatDate(lead.enquiryDate)}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-outline" id="btn-back-leads">← Leads</button>
          ${!locked && Permissions.canEditLead(lead) ? `<button class="btn btn-outline" id="btn-edit-lead">Edit</button>
            <button class="btn btn-primary" id="btn-change-status">Change Status</button>` : ''}
          ${Permissions.canAddPayment(lead) && lead.status !== 'Lost' ? `<button class="btn btn-success" id="btn-add-payment">+ Payment</button>` : ''}
          ${!locked && Permissions.canAddFollowup(lead) ? `<button class="btn btn-outline" id="btn-add-fu">+ Follow-up</button>` : ''}
        </div>
      </div>
      ${lead.status === 'Won' ? '<div class="lock-banner won">🔒 LOCKED — WON</div>' : ''}
      ${lead.status === 'Lost' ? '<div class="lock-banner lost">🔒 CLOSED — LOST</div>' : ''}

      <div class="tabs" id="lead-tabs">
        ${['overview','financials','payments','documents','followups','activity','status'].map(t =>
          `<button class="tab-btn ${t === 'overview' ? 'active' : ''}" data-tab="${t}">${
            {overview:'Overview',financials:'Financials',payments:'Payments',documents:'Documents',followups:'Follow-ups',activity:'Activity',status:'Status History'}[t]
          }</button>`).join('')}
      </div>
      <div id="tab-content"></div>`;

    document.getElementById('btn-back-leads').onclick = () => navigate('leads');
    document.getElementById('btn-edit-lead')?.addEventListener('click', () => navigate('lead-edit', { leadId }));
    document.getElementById('btn-change-status')?.addEventListener('click', () => showStatusModal(leadId));
    document.getElementById('btn-add-payment')?.addEventListener('click', () => showPaymentModal(leadId));
    document.getElementById('btn-add-fu')?.addEventListener('click', () => showFollowupModal(leadId));

    const showTab = async (tab) => {
      document.querySelectorAll('#lead-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      const tc = document.getElementById('tab-content');
      tc.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

      if (!tc.__waBound) {
        tc.__waBound = true;
        tc.addEventListener('click', (e) => {
          if (e.target.closest('#fin-wa-remind, #tab-wa-pay')) sendPaymentWhatsapp(leadId);
        });
      }

      if (tab === 'overview') {
        tc.innerHTML = `
          <div class="card"><div class="card-body">
            <div class="detail-grid">
              <div class="detail-item"><label>Customer</label><div class="value">${Utils.escapeHtml(lead.customerName)}</div></div>
              <div class="detail-item"><label>Mobile</label><div class="value">${Utils.escapeHtml(lead.mobile)}</div></div>
              <div class="detail-item"><label>Alternate Mobile</label><div class="value">${Utils.escapeHtml(lead.alternateMobile || '—')}</div></div>
              <div class="detail-item"><label>Email</label><div class="value">${Utils.escapeHtml(lead.email || '—')}</div></div>
              <div class="detail-item"><label>Company</label><div class="value">${Utils.escapeHtml(lead.companyName || '—')}</div></div>
              <div class="detail-item"><label>City / State</label><div class="value">${Utils.escapeHtml([lead.city, lead.state].filter(Boolean).join(', ') || '—')}</div></div>
              <div class="detail-item"><label>Source</label><div class="value">${Utils.escapeHtml(lead.source || '—')}</div></div>
              <div class="detail-item"><label>Type</label><div class="value">${Utils.escapeHtml(lead.enquiryType || '—')}</div></div>
              <div class="detail-item"><label>Assigned To</label><div class="value">${Utils.escapeHtml(userMap[lead.assignedTo] || '—')}</div></div>
              <div class="detail-item"><label>Created By</label><div class="value">${Utils.escapeHtml(userMap[lead.createdBy] || '—')}</div></div>
              <div class="detail-item"><label>Created</label><div class="value">${Utils.formatDateTime(lead.createdAt)}</div></div>
              <div class="detail-item"><label>Updated</label><div class="value">${Utils.formatDateTime(lead.updatedAt)}</div></div>
              ${lead.status === 'Won' ? `
                <div class="detail-item"><label>Won Date</label><div class="value">${Utils.formatDate(lead.wonDate)}</div></div>
                <div class="detail-item"><label>Deal Close Amount</label><div class="value currency">${Utils.formatCurrency(lead.dealCloseAmount)}</div></div>
                <div class="detail-item"><label>Won Notes</label><div class="value">${Utils.escapeHtml(lead.wonNotes || '—')}</div></div>` : ''}
              ${lead.status === 'Lost' ? `
                <div class="detail-item"><label>Lost Date</label><div class="value">${Utils.formatDate(lead.lostDate)}</div></div>
                <div class="detail-item"><label>Lost Reason</label><div class="value">${Utils.escapeHtml(lead.lostReason)}</div></div>
                <div class="detail-item"><label>Remarks</label><div class="value">${Utils.escapeHtml(lead.lostRemarks || '—')}</div></div>` : ''}
            </div>
            ${lead.requirements ? `<div class="mt-2"><label style="font-size:0.75rem;color:var(--text-muted);font-weight:600;text-transform:uppercase">Requirements</label>
              <p style="margin-top:0.35rem">${Utils.escapeHtml(lead.requirements)}</p></div>` : ''}
          </div></div>`;
      } else if (tab === 'financials') {
        tc.innerHTML = `
          <div class="financial-summary">
            <table>
              <tr><td class="fin-label">Offer Amount</td><td class="fin-value currency">${fin.offerAmount != null ? Utils.formatCurrency(fin.offerAmount) : '—'}</td></tr>
              <tr><td class="fin-label">Deal Close Amount</td><td class="fin-value currency">${fin.dealCloseAmount != null ? Utils.formatCurrency(fin.dealCloseAmount) : '—'}</td></tr>
              <tr><td class="fin-label">Total Deal Value</td><td class="fin-value currency">${fin.totalDealValue != null ? Utils.formatCurrency(fin.totalDealValue) : '—'}</td></tr>
              <tr><td class="fin-label">Payment Tracking Value</td><td class="fin-value currency">${Utils.formatCurrency(fin.trackingValue)}</td></tr>
              <tr><td class="fin-label">Total Received</td><td class="fin-value currency text-success">${Utils.formatCurrency(fin.totalReceived)}</td></tr>
              <tr class="fin-pending"><td class="fin-label">Pending Amount</td><td class="fin-value currency">${Utils.formatCurrency(fin.pendingAmount)}</td></tr>
              <tr><td class="fin-label">Payment Due Date</td><td class="fin-value">${Utils.formatDate(fin.nextPaymentDueDate)}</td></tr>
              <tr><td class="fin-label">Due Amount</td><td class="fin-value currency">${fin.dueAmount != null ? Utils.formatCurrency(fin.dueAmount) : '—'}</td></tr>
              <tr><td class="fin-label">Payment Status</td><td class="fin-value">${Utils.badge(fin.paymentStatus)}</td></tr>
            </table>
          </div>
          ${fin.pendingAmount > 0 && lead.mobile && lead.status !== 'Lost' ? `
          <div class="flex-between mt-2 p-1" style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:0.85rem 1rem">
            <div style="font-size:0.875rem">
              <strong>Send payment reminder</strong> to <strong>${Utils.escapeHtml(lead.customerName)}</strong>
              on ${Utils.escapeHtml(lead.mobile)} via WhatsApp
            </div>
            <button class="btn btn-whatsapp" id="fin-wa-remind">WhatsApp Reminder</button>
          </div>` : fin.pendingAmount > 0 && !lead.mobile ? `
          <p class="form-hint mt-2">Add a client mobile number to send WhatsApp payment reminders.</p>` : ''}`;
      } else if (tab === 'payments') {
        const payments = await Payments.getByLead(leadId);
        tc.innerHTML = `
          <div class="flex-between mb-2" style="flex-wrap:wrap;gap:0.5rem">
            <div><strong>Total Received:</strong> <span class="text-success currency">${Utils.formatCurrency(fin.totalReceived)}</span>
              &nbsp;·&nbsp; <strong>Pending:</strong> <span class="text-warning currency">${Utils.formatCurrency(fin.pendingAmount)}</span></div>
            <div class="flex gap-1">
              ${fin.pendingAmount > 0 && lead.mobile && lead.status !== 'Lost' ? `<button class="btn btn-whatsapp btn-sm" id="tab-wa-pay">WhatsApp Reminder</button>` : ''}
              ${Permissions.canAddPayment(lead) && lead.status !== 'Lost' ? `<button class="btn btn-success btn-sm" id="tab-add-pay">+ Payment</button>` : ''}
            </div>
          </div>
          <div class="card"><div class="table-wrap">
            ${payments.length === 0 ? '<div class="empty-state"><p>No payments recorded</p></div>' : `
            <table class="data-table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Received By</th><th>Actions</th></tr></thead>
              <tbody>${payments.map(p => `<tr>
                <td class="font-mono">${Utils.escapeHtml(p.receiptNo)}</td>
                <td>${Utils.formatDate(p.paymentDate)}</td>
                <td class="currency font-bold">${Utils.formatCurrency(p.amount)}</td>
                <td>${Utils.escapeHtml(p.paymentMethod)}</td>
                <td>${Utils.escapeHtml(p.referenceNumber || '—')}</td>
                <td>${Utils.escapeHtml(p.receivedBy)}</td>
                <td class="actions-cell">
                  <button class="btn btn-outline btn-sm" data-receipt="${p.id}">Receipt</button>
                  ${Permissions.canDeletePayment(lead) && !locked ? `<button class="btn btn-danger btn-sm" data-delpay="${p.id}">Delete</button>` : ''}
                </td>
              </tr>`).join('')}</tbody>
            </table>`}
          </div></div>`;
        document.getElementById('tab-add-pay')?.addEventListener('click', () => showPaymentModal(leadId));
        tc.querySelectorAll('[data-receipt]').forEach(b => b.onclick = () => showReceipt(b.dataset.receipt));
        tc.querySelectorAll('[data-delpay]').forEach(b => b.onclick = async () => {
          if (await confirm('Delete Payment', 'Delete this payment record?')) {
            try {
              await Payments.remove(b.dataset.delpay);
              toast('Deleted', 'Payment deleted', 'success');
              showTab('payments');
            } catch (err) { toast('Error', err.message, 'error'); }
          }
        });
      } else if (tab === 'documents') {
        const docs = await Attachments.getByLead(leadId);
        tc.innerHTML = `
          <div class="flex-between mb-2">
            <span>${docs.length} document${docs.length !== 1 ? 's' : ''}</span>
            ${Permissions.canUploadDocument(lead) ? `<button class="btn btn-primary btn-sm" id="tab-add-doc">+ Upload</button>` : ''}
          </div>
          <div class="card"><div class="card-body">
            ${docs.length === 0 ? '<div class="empty-state"><p>No documents attached</p></div>' :
              docs.map(d => `
              <div class="file-item">
                <span class="file-icon">${Attachments.isImage(d) ? '🖼️' : Attachments.isPdf(d) ? '📕' : '📄'}</span>
                <div class="file-info">
                  <div class="file-name">${Utils.escapeHtml(d.fileName)}</div>
                  <div class="file-meta">${Utils.formatFileSize(d.fileSize)} · ${Utils.escapeHtml(d.uploadedByName)} · ${Utils.formatDateTime(d.uploadedAt)}</div>
                </div>
                <button class="btn btn-outline btn-sm" data-preview="${d.id}">Preview</button>
                <button class="btn btn-outline btn-sm" data-dl="${d.id}">Download</button>
                ${Permissions.canDeleteDocument(lead) ? `<button class="btn btn-danger btn-sm" data-deldoc="${d.id}">Delete</button>` : ''}
              </div>`).join('')}
          </div></div>`;
        document.getElementById('tab-add-doc')?.addEventListener('click', () => showUploadModal(leadId));
        tc.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => previewAttachment(b.dataset.preview));
        tc.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => Attachments.download(b.dataset.dl).catch(e => toast('Error', e.message, 'error')));
        tc.querySelectorAll('[data-deldoc]').forEach(b => b.onclick = async () => {
          if (await confirm('Delete Document', 'Delete this document?')) {
            try {
              await Attachments.remove(b.dataset.deldoc);
              toast('Deleted', 'Document deleted', 'success');
              showTab('documents');
            } catch (err) { toast('Error', err.message, 'error'); }
          }
        });
      } else if (tab === 'followups') {
        const fus = await Followups.getByLead(leadId);
        tc.innerHTML = `
          <div class="flex-between mb-2">
            <span>${fus.length} follow-up${fus.length !== 1 ? 's' : ''}</span>
            ${Permissions.canAddFollowup(lead) ? `<button class="btn btn-primary btn-sm" id="tab-add-fu">+ Follow-up</button>` : ''}
          </div>
          <div class="card"><div class="card-body">
            ${fus.length === 0 ? '<div class="empty-state"><p>No follow-ups scheduled</p></div>' :
              fus.map(f => `
              <div class="file-item" style="flex-wrap:wrap">
                <div class="file-info" style="flex:1">
                  <div class="file-name">${Utils.formatDate(f.date)} ${f.time ? 'at ' + Utils.escapeHtml(f.time) : ''} ${Utils.badge(f.status)}</div>
                  <div class="file-meta">${Utils.escapeHtml(f.notes || 'No notes')} · by ${Utils.escapeHtml(f.createdByName)}</div>
                </div>
                ${f.status !== 'Completed' && lead.mobile ?
                  `<button class="btn btn-whatsapp btn-sm" data-wa-fu-tab="${f.id}">WhatsApp</button>` : ''}
                ${f.status !== 'Completed' && Permissions.canCompleteFollowup(lead) ?
                  `<button class="btn btn-success btn-sm" data-complete-fu="${f.id}">Complete</button>` : ''}
              </div>`).join('')}
          </div></div>`;
        document.getElementById('tab-add-fu')?.addEventListener('click', () => showFollowupModal(leadId));
        tc.querySelectorAll('[data-wa-fu-tab]').forEach(b => b.onclick = () => sendFollowupWhatsapp(b.dataset.waFuTab));
        tc.querySelectorAll('[data-complete-fu]').forEach(b => b.onclick = async () => {
          try {
            await Followups.complete(b.dataset.completeFu);
            toast('Completed', 'Follow-up marked complete', 'success');
            showTab('followups');
          } catch (err) { toast('Error', err.message, 'error'); }
        });
      } else if (tab === 'activity') {
        const logs = await Audit.getByLead(leadId);
        tc.innerHTML = `<div class="card"><div class="card-body">
          ${logs.length === 0 ? '<div class="empty-state"><p>No activity yet</p></div>' :
            `<div class="timeline">${logs.map(l => `
              <div class="timeline-item">
                <div class="tl-title">${Utils.escapeHtml(l.action)}</div>
                <div class="tl-desc">${Utils.escapeHtml(l.description)}</div>
                <div class="tl-meta">${Utils.escapeHtml(l.userName)} (${Utils.escapeHtml(l.role)}) · ${Utils.formatDateTime(l.createdAt)}</div>
              </div>`).join('')}</div>`}
        </div></div>`;
      } else if (tab === 'status') {
        const hist = await Leads.getStatusHistory(leadId);
        tc.innerHTML = `<div class="card"><div class="card-body">
          ${hist.length === 0 ? '<div class="empty-state"><p>No status changes</p></div>' :
            `<div class="timeline">${hist.map(h => `
              <div class="timeline-item">
                <div class="tl-title">${h.fromStatus ? Utils.escapeHtml(h.fromStatus) + ' → ' : ''}${Utils.escapeHtml(h.toStatus)}</div>
                <div class="tl-desc">${Utils.escapeHtml(h.notes || '')}</div>
                <div class="tl-meta">${Utils.escapeHtml(h.changedByName)} · ${Utils.formatDateTime(h.changedAt)}</div>
              </div>`).join('')}</div>`}
        </div></div>`;
      }
    };

    document.querySelectorAll('#lead-tabs .tab-btn').forEach(btn => {
      btn.onclick = () => showTab(btn.dataset.tab);
    });
    await showTab(startTab);
  }

  /* ========== STATUS MODAL ========== */
  async function showStatusModal(leadId) {
    const lead = await Leads.getById(leadId);
    if (Permissions.isLeadLocked(lead)) {
      toast('Locked', 'This lead is permanently locked.', 'error');
      return;
    }
    const allowed = Permissions.getAllowedTransitions(lead.status);
    if (!allowed.length) {
      toast('Info', 'No status transitions available.', 'info');
      return;
    }

    openModal(`
      <div class="modal-header"><h2>Change Status</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        <p class="mb-2">Current status: ${Utils.badge(lead.status)}</p>
        <div class="form-group"><label>New Status <span class="required">*</span></label>
          <select class="form-control" id="st-new">
            <option value="">Select…</option>
            ${allowed.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div id="st-won-fields" class="hidden">
          <div class="form-group"><label>Won Date <span class="required">*</span></label>
            <input type="date" class="form-control" id="st-wondate" value="${Utils.today()}"></div>
          <div class="form-group"><label>Deal Close Amount / Project Value (₹) <span class="required">*</span></label>
            <input type="number" class="form-control" id="st-closeamt" min="0.01" step="0.01"
              value="${lead.totalDealValue || lead.offerAmount || ''}"></div>
          <div class="form-group"><label>Won Notes</label>
            <textarea class="form-control" id="st-wonnotes" rows="2"></textarea></div>
          <div class="setup-banner">⚠️ Once marked Won, this lead will be permanently locked and cannot be edited or reopened.</div>
        </div>
        <div id="st-lost-fields" class="hidden">
          <div class="form-group"><label>Lost Date <span class="required">*</span></label>
            <input type="date" class="form-control" id="st-lostdate" value="${Utils.today()}"></div>
          <div class="form-group"><label>Lost Reason <span class="required">*</span></label>
            <select class="form-control" id="st-lostreason">
              <option value="">Select…</option>
              ${Leads.LOST_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
            </select></div>
          <div class="form-group"><label>Remarks</label>
            <textarea class="form-control" id="st-lostremarks" rows="2"></textarea></div>
          <div class="setup-banner">⚠️ Once marked Lost, this lead will be permanently closed and cannot be reopened.</div>
        </div>
        <div class="form-group" id="st-notes-wrap">
          <label>Notes</label>
          <textarea class="form-control" id="st-notes" rows="2"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="st-save">Update Status</button>
      </div>`);

    document.getElementById('st-new').onchange = () => {
      const v = document.getElementById('st-new').value;
      document.getElementById('st-won-fields').classList.toggle('hidden', v !== 'Won');
      document.getElementById('st-lost-fields').classList.toggle('hidden', v !== 'Lost');
      document.getElementById('st-notes-wrap').classList.toggle('hidden', v === 'Won' || v === 'Lost');
    };

    document.getElementById('st-save').onclick = async () => {
      const newStatus = document.getElementById('st-new').value;
      if (!newStatus) { toast('Error', 'Select a status', 'error'); return; }
      try {
        const extra = { notes: document.getElementById('st-notes')?.value };
        if (newStatus === 'Won') {
          extra.wonDate = document.getElementById('st-wondate').value;
          extra.dealCloseAmount = document.getElementById('st-closeamt').value;
          extra.wonNotes = document.getElementById('st-wonnotes').value;
          if (!(await confirm('Confirm Won', 'Mark this lead as Won? It will be permanently locked.', 'This action cannot be undone.'))) return;
        }
        if (newStatus === 'Lost') {
          extra.lostDate = document.getElementById('st-lostdate').value;
          extra.lostReason = document.getElementById('st-lostreason').value;
          extra.lostRemarks = document.getElementById('st-lostremarks').value;
          if (!(await confirm('Confirm Lost', 'Mark this lead as Lost? It will be permanently closed.', 'This action cannot be undone.'))) return;
        }
        await Leads.changeStatus(leadId, newStatus, extra);
        closeModal();
        toast('Status Updated', `Lead is now ${newStatus}`, 'success');
        viewLead(leadId);
      } catch (err) { toast('Error', err.message, 'error'); }
    };
  }

  /* ========== PAYMENT MODAL ========== */
  async function showPaymentModal(leadId) {
    const lead = await Leads.getById(leadId);
    const fin = await Leads.getFinancials(leadId);

    openModal(`
      <div class="modal-header"><h2>+ Record Payment</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        <p class="mb-2"><strong>${Utils.escapeHtml(lead.enquiryNo)}</strong> — ${Utils.escapeHtml(lead.customerName)}</p>
        <p class="mb-2">Outstanding: <strong class="text-warning currency">${Utils.formatCurrency(fin.pendingAmount)}</strong>
          &nbsp;· Tracking value: ${Utils.formatCurrency(fin.trackingValue)}</p>
        <div class="form-row">
          <div class="form-group"><label>Amount (₹) <span class="required">*</span></label>
            <input type="number" class="form-control" id="pay-amt" min="0.01" step="0.01" max="${fin.pendingAmount}" required></div>
          <div class="form-group"><label>Payment Date <span class="required">*</span></label>
            <input type="date" class="form-control" id="pay-date" value="${Utils.today()}" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Payment Method <span class="required">*</span></label>
            <select class="form-control" id="pay-method" required>
              <option value="">Select…</option>
              ${Payments.METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}
            </select></div>
          <div class="form-group"><label>Reference Number</label>
            <input class="form-control" id="pay-ref"></div>
        </div>
        <div class="form-group"><label>Notes</label>
          <textarea class="form-control" id="pay-notes" rows="2"></textarea></div>
        <div class="form-group"><label>Receipt Attachment (optional)</label>
          <input type="file" class="form-control" id="pay-file" accept=".pdf,.jpg,.jpeg,.png"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-success" id="pay-save">Save Payment</button>
      </div>`);

    document.getElementById('pay-save').onclick = async () => {
      if (submitting) return;
      submitting = true;
      try {
        const fileInput = document.getElementById('pay-file');
        const payment = await Payments.create({
          leadId,
          amount: document.getElementById('pay-amt').value,
          paymentDate: document.getElementById('pay-date').value,
          paymentMethod: document.getElementById('pay-method').value,
          referenceNumber: document.getElementById('pay-ref').value,
          notes: document.getElementById('pay-notes').value,
          file: fileInput.files[0] || null
        });
        closeModal();
        toast('Payment Recorded', `${payment.receiptNo} — ${Utils.formatCurrency(payment.amount)}`, 'success');
        viewLead(leadId);
      } catch (err) {
        toast('Error', err.message, 'error');
      } finally {
        submitting = false;
      }
    };
  }

  async function showReceipt(paymentId) {
    const payment = await Payments.getById(paymentId);
    if (!payment) return;
    const lead = await DB.get('leads', payment.leadId);
    const company = await Payments.getCompanyInfo();
    const html = Payments.buildReceiptHtml(payment, lead, company);

    openModal(`
      <div class="modal-header"><h2>Payment Receipt</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">${html}</div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
        <button class="btn btn-primary" id="receipt-print">Print</button>
      </div>`, { size: 'modal-lg' });

    document.getElementById('receipt-print').onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>${payment.receiptNo}</title>
        <style>body{font-family:sans-serif;padding:2rem}
        .receipt-row{display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #eee}
        .receipt-amount{text-align:center;font-size:1.8rem;font-weight:700;color:#16a34a;padding:1.25rem 0}
        .receipt-header{text-align:center;border-bottom:2px solid #2563eb;padding-bottom:1rem;margin-bottom:1.5rem}
        .receipt-header h2{color:#2563eb}</style></head><body>${html}</body></html>`);
      w.document.close();
      w.print();
    };
  }

  /* ========== FOLLOW-UP MODAL ========== */
  async function showFollowupModal(leadId) {
    const lead = await Leads.getById(leadId);
    openModal(`
      <div class="modal-header"><h2>+ Follow-up</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        <p class="mb-2"><strong>${Utils.escapeHtml(lead.enquiryNo)}</strong> — ${Utils.escapeHtml(lead.customerName)}</p>
        <div class="form-row">
          <div class="form-group"><label>Date <span class="required">*</span></label>
            <input type="date" class="form-control" id="fu-date" value="${Utils.today()}" required></div>
          <div class="form-group"><label>Time</label>
            <input type="time" class="form-control" id="fu-time"></div>
        </div>
        <div class="form-group"><label>Notes</label>
          <textarea class="form-control" id="fu-notes" rows="3"></textarea></div>
        <div class="form-group"><label>Next Follow-up Date</label>
          <input type="date" class="form-control" id="fu-next"></div>
        <div class="form-group"><label>Attachment (optional)</label>
          <input type="file" class="form-control" id="fu-file"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fu-save">Save Follow-up</button>
      </div>`);

    document.getElementById('fu-save').onclick = async () => {
      try {
        const fileInput = document.getElementById('fu-file');
        await Followups.create({
          leadId,
          date: document.getElementById('fu-date').value,
          time: document.getElementById('fu-time').value,
          notes: document.getElementById('fu-notes').value,
          nextFollowupDate: document.getElementById('fu-next').value,
          file: fileInput.files[0] || null
        });
        closeModal();
        toast('Scheduled', 'Follow-up created', 'success');
        if (currentPage === 'lead-detail') viewLead(leadId);
        else navigate('followups');
      } catch (err) { toast('Error', err.message, 'error'); }
    };
  }

  async function showUploadModal(leadId) {
    openModal(`
      <div class="modal-header"><h2>Upload Document</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Select File <span class="required">*</span></label>
          <input type="file" class="form-control" id="up-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip" required>
          <div class="form-hint">Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, ZIP</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="up-save">Upload</button>
      </div>`);
    document.getElementById('up-save').onclick = async () => {
      const file = document.getElementById('up-file').files[0];
      if (!file) { toast('Error', 'Select a file', 'error'); return; }
      try {
        await Attachments.upload({ file, leadId });
        closeModal();
        toast('Uploaded', file.name, 'success');
        viewLead(leadId);
      } catch (err) { toast('Error', err.message, 'error'); }
    };
  }

  async function previewAttachment(id) {
    const att = await Attachments.getById(id);
    if (!att) return;
    const url = Attachments.getObjectUrl(att);
    if (Attachments.isImage(att)) {
      openModal(`
        <div class="modal-header"><h2>${Utils.escapeHtml(att.fileName)}</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
        <div class="modal-body text-center"><img src="${url}" style="max-height:70vh;border-radius:8px" alt=""></div>
        <div class="modal-footer"><button class="btn btn-outline" onclick="App.closeModal()">Close</button>
          <button class="btn btn-primary" onclick="Attachments.download('${id}')">Download</button></div>`, { size: 'modal-lg' });
    } else if (Attachments.isPdf(att)) {
      openModal(`
        <div class="modal-header"><h2>${Utils.escapeHtml(att.fileName)}</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
        <div class="modal-body"><iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe></div>
        <div class="modal-footer"><button class="btn btn-outline" onclick="App.closeModal()">Close</button>
          <button class="btn btn-primary" onclick="Attachments.download('${id}')">Download</button></div>`, { size: 'modal-xl' });
    } else {
      await Attachments.download(id);
    }
  }

  /* ========== PAYMENTS PAGE ========== */
  async function renderPayments(el) {
    const payments = await Payments.getAll();
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Payments</h1><div class="subtitle">${payments.length} payment${payments.length !== 1 ? 's' : ''}</div></div>
      </div>
      <div class="card"><div class="table-wrap">
        ${payments.length === 0 ? '<div class="empty-state"><div class="empty-icon">💰</div><h3>No payments recorded</h3><p>Record payments from lead details.</p></div>' : `
        <table class="data-table">
          <thead><tr><th>Receipt</th><th>Enquiry</th><th>Customer</th><th>Amount</th><th>Date</th><th>Method</th><th>Reference</th><th>Received By</th><th>Actions</th></tr></thead>
          <tbody>${payments.map(p => `<tr>
            <td class="font-mono">${Utils.escapeHtml(p.receiptNo)}</td>
            <td><a href="#" data-view="${p.leadId}">${Utils.escapeHtml(p.enquiryNo)}</a></td>
            <td>${Utils.escapeHtml(p.customerName)}</td>
            <td class="currency font-bold">${Utils.formatCurrency(p.amount)}</td>
            <td>${Utils.formatDate(p.paymentDate)}</td>
            <td>${Utils.escapeHtml(p.paymentMethod)}</td>
            <td>${Utils.escapeHtml(p.referenceNumber || '—')}</td>
            <td>${Utils.escapeHtml(p.receivedBy)}</td>
            <td class="actions-cell">
              <button class="btn btn-outline btn-sm" data-receipt="${p.id}">Receipt</button>
              <button class="btn btn-outline btn-sm" data-view="${p.leadId}">Lead</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>`}
      </div></div>`;
    el.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); viewLead(b.dataset.view); };
    });
    el.querySelectorAll('[data-receipt]').forEach(b => b.onclick = () => showReceipt(b.dataset.receipt));
  }

  /* ========== FOLLOW-UPS PAGE ========== */
  async function renderFollowups(el) {
    const grouped = await Followups.getGrouped();
    const renderGroup = (title, items, color) => `
      <div class="card mb-2">
        <div class="card-header"><h3>${title} (${items.length})</h3></div>
        <div class="card-body">
          ${items.length === 0 ? '<p class="text-muted">None</p>' :
            items.map(f => `
            <div class="file-item">
              <div class="file-info">
                <div class="file-name">
                  <a href="#" data-view="${f.leadId}">${Utils.escapeHtml(f.enquiryNo)}</a>
                  — ${Utils.escapeHtml(f.customerName)}
                  ${Utils.badge(f.status)}
                </div>
                <div class="file-meta">${Utils.formatDate(f.date)} ${f.time || ''} · ${Utils.escapeHtml(f.notes || '')} · ${Utils.escapeHtml(f.createdByName)}</div>
              </div>
              ${f.status !== 'Completed' ? `<button class="btn btn-whatsapp btn-sm" data-wa-fu="${f.id}">WhatsApp</button>
                <button class="btn btn-success btn-sm" data-complete="${f.id}">Complete</button>` : ''}
            </div>`).join('')}
        </div>
      </div>`;

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Follow-ups</h1><div class="subtitle">Manage your scheduled follow-ups</div></div>
      </div>
      ${renderGroup('🔴 Overdue', grouped.overdue)}
      ${renderGroup('📅 Today', grouped.today)}
      ${renderGroup('🔜 Upcoming', grouped.upcoming)}
      ${renderGroup('✅ Completed', grouped.completed.slice(0, 20))}`;

    el.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); viewLead(b.dataset.view); };
    });
    el.querySelectorAll('[data-wa-fu]').forEach(b => {
      b.onclick = () => sendFollowupWhatsapp(b.dataset.waFu);
    });
    el.querySelectorAll('[data-complete]').forEach(b => {
      b.onclick = async () => {
        try {
          await Followups.complete(b.dataset.complete);
          toast('Completed', 'Follow-up marked complete', 'success');
          navigate('followups');
        } catch (err) { toast('Error', err.message, 'error'); }
      };
    });
  }

  /* ========== REPORTS ========== */
  let reportsActiveTab = 'leads';

  async function renderReports(el) {
    if (!Permissions.canViewReports()) throw new Error('Permission denied.');
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Reports</h1><div class="subtitle">Business insights, printing and exports</div></div>
      </div>
      <div class="report-tabs report-no-print">
        <button data-rtab="leads" class="${reportsActiveTab === 'leads' ? 'active' : ''}">Lead Report</button>
        <button data-rtab="payments" class="${reportsActiveTab === 'payments' ? 'active' : ''}">Payment Report</button>
        <button data-rtab="executive" class="${reportsActiveTab === 'executive' ? 'active' : ''}">Executive Performance</button>
      </div>
      <div id="report-body"></div>`;
    el.querySelectorAll('[data-rtab]').forEach(b => {
      b.onclick = () => {
        reportsActiveTab = b.dataset.rtab;
        el.querySelectorAll('[data-rtab]').forEach(x => x.classList.toggle('active', x === b));
        loadReportTab();
      };
    });
    await loadReportTab();

    async function loadReportTab() {
      const body = document.getElementById('report-body');
      body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Building report…</div>';
      if (reportsActiveTab === 'leads') await renderLeadReport(body);
      else if (reportsActiveTab === 'payments') await renderPaymentReport(body);
      else await renderExecutiveReport(body);
    }
  }

  function downloadCsv(headers, rows, filename) {
    const csv = Utils.arrayToCsv(rows, headers);
    Utils.downloadText(csv, filename, 'text/csv;charset=utf-8');
  }

  function printReport(title, subtitle, summaryHtml, tableHtml) {
    const w = window.open('', '_blank');
    if (!w) { toast('Error', 'Allow pop-ups to print reports', 'error'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
      <style>
        body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#111}
        h1{margin:0;font-size:20px} .sub{color:#555;font-size:12px;margin:4px 0 16px}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-top:12px}
        th,td{border:1px solid #999;padding:5px 7px;text-align:left}
        th{background:#eef2f7}
        .cur{text-align:right;font-variant-numeric:tabular-nums}
        .totals td{font-weight:700;background:#f3f4f6;border-top:2px solid #333}
        .summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
        .stat{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-width:120px}
        .stat .l{font-size:10px;text-transform:uppercase;color:#666}
        .stat .v{font-size:15px;font-weight:700}
        .badge{padding:2px 7px;border-radius:10px;font-size:10px;border:1px solid #999}
      </style></head><body>
      <h1>${title}</h1><div class="sub">${subtitle}</div>
      ${summaryHtml || ''}
      ${tableHtml}
      <p style="font-size:10px;color:#888;margin-top:16px">Generated by LeadFlow CRM on ${Utils.escapeHtml(Utils.formatDateTime(Utils.now()))}</p>
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 350);
  }

  async function renderLeadReport(body) {
    const users = await DB.getAll('users');
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    const leadsRaw = await Leads.getAll();
    const leads = [];
    for (const l of leadsRaw) {
      const fin = await Leads.getFinancials(l.id);
      leads.push({ ...l, ...fin, assigneeName: userMap[l.assignedTo] || '—' });
    }

    const fromDefault = leads.length ? leads.reduce((m, l) => (l.enquiryDate < m || !m ? l.enquiryDate : m), '') : Utils.today();

    body.innerHTML = `
      <div class="card report-no-print mb-2"><div class="card-body">
        <div class="filters-bar" style="margin-bottom:0">
          <label class="form-check" style="font-size:0.8rem"><b>From</b>&nbsp;<input type="date" class="form-control" id="lr-from" value=""></label>
          <label class="form-check" style="font-size:0.8rem"><b>To</b>&nbsp;<input type="date" class="form-control" id="lr-to" value=""></label>
          <select class="form-control" id="lr-status">
            <option value="">All Statuses</option>
            ${Leads.STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <select class="form-control" id="lr-source">
            <option value="">All Sources</option>
            ${Leads.SOURCES.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
          ${Permissions.canViewAllLeads() ? `<select class="form-control" id="lr-assigned">
            <option value="">All Assignees</option>
            ${users.filter(u => u.active).map(u => `<option value="${u.id}">${Utils.escapeHtml(u.name)}</option>`).join('')}
          </select>` : ''}
          <select class="form-control" id="lr-pay">
            <option value="">All Payment Status</option>
            ${['Not Applicable','Pending','Partially Paid','Paid','Due','Overdue'].map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="lr-apply">Apply</button>
          <button class="btn btn-outline" id="lr-print">🖨 Print</button>
          <button class="btn btn-outline" id="lr-csv">⬇ CSV</button>
        </div>
      </div></div>
      <div id="lr-output"></div>`;

    const apply = () => {
      const f = {
        from: document.getElementById('lr-from').value,
        to: document.getElementById('lr-to').value,
        status: document.getElementById('lr-status').value,
        source: document.getElementById('lr-source').value,
        assigned: document.getElementById('lr-assigned')?.value || '',
        pay: document.getElementById('lr-pay').value
      };

      let rows = leads.filter(l => {
        if (f.from && l.enquiryDate < f.from) return false;
        if (f.to && l.enquiryDate > f.to) return false;
        if (f.status && l.status !== f.status) return false;
        if (f.source && l.source !== f.source) return false;
        if (f.assigned && l.assignedTo !== f.assigned) return false;
        if (f.pay && l.paymentStatus !== f.pay) return false;
        return true;
      });

      const totalOffer = rows.reduce((s, l) => s + (Number(l.offerAmount) || 0), 0);
      const totalTracking = rows.reduce((s, l) => s + (Number(l.trackingValue) || 0), 0);
      const totalReceived = rows.reduce((s, l) => s + (Number(l.totalReceived) || 0), 0);
      const totalPending = rows.reduce((s, l) => s + (Number(l.pendingAmount) || 0), 0);
      const wonCount = rows.filter(l => l.status === 'Won').length;
      const lostCount = rows.filter(l => l.status === 'Lost').length;

      const summary = `
        <div class="report-summary report-no-print">
          ${[
            ['Total Leads', rows.length, ''],
            ['Won', wonCount, 'text-success'],
            ['Lost', lostCount, 'text-danger'],
            ['Offer Value', Utils.formatCurrency(totalOffer), ''],
            ['Deal Value', Utils.formatCurrency(totalTracking), ''],
            ['Received', Utils.formatCurrency(totalReceived), 'text-success'],
            ['Pending', Utils.formatCurrency(totalPending), 'text-warning']
          ].map(([l, v, c]) => `<div class="report-stat"><div class="rs-label">${l}</div><div class="rs-value ${c}">${v}</div></div>`).join('')}
        </div>`;

      const tableHtml = `
        <div class="card"><div class="table-wrap">
          ${rows.length === 0 ? '<div class="empty-state"><p>No leads match the selected filters.</p></div>' : `
          <table class="data-table" id="lr-table">
            <thead><tr>
              <th>Enquiry No</th><th>Date</th><th>Customer</th><th>Company</th><th>Mobile</th>
              <th>Source</th><th>Type</th><th>Assigned</th>
              <th class="text-right">Offer</th><th class="text-right">Close Amt</th>
              <th class="text-right">Deal Value</th><th class="text-right">Received</th>
              <th class="text-right">Pending</th><th>Pay Status</th><th>Status</th>
            </tr></thead>
            <tbody>
              ${rows.map(l => `<tr>
                <td class="font-mono"><a href="#" data-view="${l.id}">${Utils.escapeHtml(l.enquiryNo)}</a></td>
                <td>${Utils.formatDate(l.enquiryDate)}</td>
                <td>${Utils.escapeHtml(l.customerName)}</td>
                <td>${Utils.escapeHtml(l.companyName || '—')}</td>
                <td>${Utils.escapeHtml(l.mobile)}</td>
                <td>${Utils.escapeHtml(l.source || '—')}</td>
                <td>${Utils.escapeHtml(l.enquiryType || '—')}</td>
                <td>${Utils.escapeHtml(l.assigneeName)}</td>
                <td class="currency text-right">${l.offerAmount != null ? Utils.formatCurrency(l.offerAmount) : '—'}</td>
                <td class="currency text-right">${l.dealCloseAmount != null ? Utils.formatCurrency(l.dealCloseAmount) : '—'}</td>
                <td class="currency text-right">${l.trackingValue ? Utils.formatCurrency(l.trackingValue) : '—'}</td>
                <td class="currency text-right text-success">${Utils.formatCurrency(l.totalReceived)}</td>
                <td class="currency text-right font-bold">${Utils.formatCurrency(l.pendingAmount)}</td>
                <td>${Utils.badge(l.paymentStatus)}</td>
                <td>${Utils.badge(l.status)}</td>
              </tr>`).join('')}
              <tr class="report-totals-row">
                <td colspan="8">TOTAL (${rows.length} leads)</td>
                <td class="currency text-right">${Utils.formatCurrency(totalOffer)}</td>
                <td></td>
                <td class="currency text-right">${Utils.formatCurrency(totalTracking)}</td>
                <td class="currency text-right text-success">${Utils.formatCurrency(totalReceived)}</td>
                <td class="currency text-right">${Utils.formatCurrency(totalPending)}</td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>`}
        </div></div>`;

      document.getElementById('lr-output').innerHTML = summary + tableHtml;
      document.getElementById('lr-output').querySelectorAll('[data-view]').forEach(a => {
        a.onclick = (e) => { e.preventDefault(); viewLead(a.dataset.view); };
      });

      const rangeLabel = (f.from || 'Start') + ' to ' + (f.to || 'Today');
      document.getElementById('lr-print').onclick = () => {
        const pTable = document.getElementById('lr-table');
        if (!pTable) { toast('Info', 'No data to print', 'warning'); return; }
        pTable.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); });
        printReport('Lead Report', 'Period: ' + rangeLabel,
          `<div class="summary">
            <div class="stat"><div class="l">Leads</div><div class="v">${rows.length}</div></div>
            <div class="stat"><div class="l">Won</div><div class="v">${wonCount}</div></div>
            <div class="stat"><div class="l">Lost</div><div class="v">${lostCount}</div></div>
            <div class="stat"><div class="l">Deal Value</div><div class="v">${Utils.formatCurrency(totalTracking)}</div></div>
            <div class="stat"><div class="l">Received</div><div class="v">${Utils.formatCurrency(totalReceived)}</div></div>
            <div class="stat"><div class="l">Pending</div><div class="v">${Utils.formatCurrency(totalPending)}</div></div>
          </div>`,
          '<table>' + pTable.innerHTML + '</table>');
      };

      document.getElementById('lr-csv').onclick = () => {
        if (!rows.length) { toast('Info', 'No data to export', 'warning'); return; }
        const headers = ['Enquiry No','Date','Customer','Company','Mobile','Source','Type','Assigned To','Offer Amount','Deal Close Amount','Deal Value','Received','Pending','Payment Status','Status'];
        const data = rows.map(l => [l.enquiryNo, l.enquiryDate, l.customerName, l.companyName, l.mobile, l.source, l.enquiryType, l.assigneeName, l.offerAmount ?? '', l.dealCloseAmount ?? '', l.trackingValue, l.totalReceived, l.pendingAmount, l.paymentStatus, l.status]);
        data.push(['TOTAL','','','','','','','', totalOffer, '', totalTracking, totalReceived, totalPending, '', '']);
        downloadCsv(headers, data, `lead-report-${Utils.today()}.csv`);
        toast('Exported', 'Lead report CSV downloaded', 'success');
      };
    };

    document.getElementById('lr-apply').onclick = apply;
    ['lr-from','lr-to','lr-status','lr-source','lr-assigned','lr-pay'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', apply);
    });
    apply();
  }

  async function renderPaymentReport(body) {
    const users = await DB.getAll('users');
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    const leads = await Leads.getAll();
    const leadMap = Object.fromEntries(leads.map(l => [l.id, l]));
    let payments = (await Payments.getAll()).map(p => ({
      ...p,
      assigneeName: userMap[leadMap[p.leadId]?.assignedTo] || '—'
    }));

    body.innerHTML = `
      <div class="card report-no-print mb-2"><div class="card-body">
        <div class="filters-bar" style="margin-bottom:0">
          <label class="form-check" style="font-size:0.8rem"><b>From</b>&nbsp;<input type="date" class="form-control" id="pr-from" value=""></label>
          <label class="form-check" style="font-size:0.8rem"><b>To</b>&nbsp;<input type="date" class="form-control" id="pr-to" value=""></label>
          <select class="form-control" id="pr-method">
            <option value="">All Methods</option>
            ${Payments.METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
          <input class="form-control search-input" id="pr-search" placeholder="Search customer / receipt / reference…">
          <button class="btn btn-primary" id="pr-apply">Apply</button>
          <button class="btn btn-outline" id="pr-print">🖨 Print</button>
          <button class="btn btn-outline" id="pr-csv">⬇ CSV</button>
        </div>
      </div></div>
      <div id="pr-output"></div>`;

    const apply = () => {
      const f = {
        from: document.getElementById('pr-from').value,
        to: document.getElementById('pr-to').value,
        method: document.getElementById('pr-method').value,
        q: document.getElementById('pr-search').value.trim().toLowerCase()
      };

      let rows = payments.filter(p => {
        if (f.from && p.paymentDate < f.from) return false;
        if (f.to && p.paymentDate > f.to) return false;
        if (f.method && p.paymentMethod !== f.method) return false;
        if (f.q) {
          const hay = `${p.customerName} ${p.receiptNo} ${p.referenceNumber} ${p.enquiryNo}`.toLowerCase();
          if (!hay.includes(f.q)) return false;
        }
        return true;
      }).sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1));

      const total = rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const byMethod = {};
      Payments.METHODS.forEach(m => { byMethod[m] = 0; });
      rows.forEach(p => { byMethod[p.paymentMethod] = (byMethod[p.paymentMethod] || 0) + (Number(p.amount) || 0); });

      const methodStats = Object.entries(byMethod).filter(([, v]) => v > 0)
        .map(([m, v]) => `<div class="report-stat"><div class="rs-label">${Utils.escapeHtml(m)}</div><div class="rs-value">${Utils.formatCurrency(v)}</div></div>`).join('');

      const summary = `
        <div class="report-summary report-no-print">
          <div class="report-stat"><div class="rs-label">Payments</div><div class="rs-value">${rows.length}</div></div>
          <div class="report-stat"><div class="rs-label">Total Collected</div><div class="rs-value text-success">${Utils.formatCurrency(total)}</div></div>
        </div>
        ${methodStats ? `<div class="report-summary report-no-print">${methodStats}</div>` : ''}`;

      const tableHtml = `
        <div class="card"><div class="table-wrap">
          ${rows.length === 0 ? '<div class="empty-state"><p>No payments match the selected filters.</p></div>' : `
          <table class="data-table" id="pr-table">
            <thead><tr>
              <th>Receipt No</th><th>Enquiry</th><th>Customer</th><th>Date</th>
              <th>Method</th><th>Reference</th><th>Received By</th><th class="text-right">Amount</th>
            </tr></thead>
            <tbody>
              ${rows.map(p => `<tr>
                <td class="font-mono">${Utils.escapeHtml(p.receiptNo)}</td>
                <td><a href="#" data-view="${p.leadId}">${Utils.escapeHtml(p.enquiryNo)}</a></td>
                <td>${Utils.escapeHtml(p.customerName)}</td>
                <td>${Utils.formatDate(p.paymentDate)}</td>
                <td>${Utils.escapeHtml(p.paymentMethod)}</td>
                <td>${Utils.escapeHtml(p.referenceNumber || '—')}</td>
                <td>${Utils.escapeHtml(p.receivedBy)}</td>
                <td class="currency text-right font-bold">${Utils.formatCurrency(p.amount)}</td>
              </tr>`).join('')}
              <tr class="report-totals-row">
                <td colspan="7">TOTAL COLLECTED (${rows.length} payments)</td>
                <td class="currency text-right text-success">${Utils.formatCurrency(total)}</td>
              </tr>
            </tbody>
          </table>`}
        </div></div>`;

      document.getElementById('pr-output').innerHTML = summary + tableHtml;
      document.getElementById('pr-output').querySelectorAll('[data-view]').forEach(a => {
        a.onclick = (e) => { e.preventDefault(); viewLead(a.dataset.view); };
      });

      const rangeLabel = (f.from || 'Start') + ' to ' + (f.to || 'Today');
      document.getElementById('pr-print').onclick = () => {
        const t = document.getElementById('pr-table');
        if (!t) { toast('Info', 'No data to print', 'warning'); return; }
        t.querySelectorAll('a').forEach(a => a.removeAttribute('href'));
        printReport('Payment Collection Report', 'Period: ' + rangeLabel,
          `<div class="summary">
            <div class="stat"><div class="l">Payments</div><div class="v">${rows.length}</div></div>
            <div class="stat"><div class="l">Total Collected</div><div class="v">${Utils.formatCurrency(total)}</div></div>
          </div>`,
          '<table>' + t.innerHTML + '</table>');
      };

      document.getElementById('pr-csv').onclick = () => {
        if (!rows.length) { toast('Info', 'No data to export', 'warning'); return; }
        const headers = ['Receipt No','Enquiry No','Customer','Payment Date','Method','Reference','Received By','Amount'];
        const data = rows.map(p => [p.receiptNo, p.enquiryNo, p.customerName, p.paymentDate, p.paymentMethod, p.referenceNumber, p.receivedBy, p.amount]);
        data.push(['TOTAL','','','','','','', total]);
        downloadCsv(headers, data, `payment-report-${Utils.today()}.csv`);
        toast('Exported', 'Payment report CSV downloaded', 'success');
      };
    };

    document.getElementById('pr-apply').onclick = apply;
    ['pr-from','pr-to','pr-method'].forEach(id => document.getElementById(id).addEventListener('change', apply));
    document.getElementById('pr-search').addEventListener('input', Utils.debounce(apply, 250));
    apply();
  }

  async function renderExecutiveReport(body) {
    const rows = await Reports.getExecutivePerformance();
    const totals = rows.reduce((a, e) => ({
      leads: a.leads + e.totalLeads, won: a.won + e.won, lost: a.lost + e.lost, value: a.value + (Number(e.dealValue) || 0)
    }), { leads: 0, won: 0, lost: 0, value: 0 });

    body.innerHTML = `
      <div class="report-summary">
        <div class="report-stat"><div class="rs-label">Users</div><div class="rs-value">${rows.length}</div></div>
        <div class="report-stat"><div class="rs-label">Total Leads</div><div class="rs-value">${totals.leads}</div></div>
        <div class="report-stat"><div class="rs-label">Total Won</div><div class="rs-value text-success">${totals.won}</div></div>
        <div class="report-stat"><div class="rs-label">Total Lost</div><div class="rs-value text-danger">${totals.lost}</div></div>
        <div class="report-stat"><div class="rs-label">Won Deal Value</div><div class="rs-value">${Utils.formatCurrency(totals.value)}</div></div>
      </div>
      <div class="card"><div class="table-wrap">
        ${rows.length === 0 ? '<div class="empty-state"><p>No performance data yet.</p></div>' : `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Role</th><th>Total Leads</th><th>Active</th><th>Won</th><th>Lost</th><th>Conversion</th><th class="text-right">Won Deal Value</th></tr></thead>
          <tbody>${rows.map(e => {
            const closed = e.won + e.lost;
            const conv = closed ? Math.round((e.won / closed) * 1000) / 10 : 0;
            return `<tr>
              <td>${Utils.escapeHtml(e.name)}</td>
              <td>${Utils.badge(e.role)}</td>
              <td>${e.totalLeads}</td><td>${e.active}</td><td>${e.won}</td><td>${e.lost}</td>
              <td>${conv}%</td>
              <td class="currency text-right">${Utils.formatCurrency(e.dealValue)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`}
      </div></div>`;
  }

  /* ========== USERS ========== */
  async function renderUsers(el) {
    if (!Permissions.canManageUsers()) throw new Error('Permission denied.');
    const users = await DB.getAll('users');

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Users</h1><div class="subtitle">${users.length} user${users.length !== 1 ? 's' : ''}</div></div>
        <div class="page-actions"><button class="btn btn-primary" id="btn-add-user">+ Add User</button></div>
      </div>
      <div class="card"><div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
          <tbody>${users.map(u => `<tr>
            <td>${Utils.escapeHtml(u.name)}</td>
            <td class="font-mono">${Utils.escapeHtml(u.username)}</td>
            <td>${Utils.escapeHtml(u.email || '—')}</td>
            <td>${Utils.badge(u.role)}</td>
            <td>${Utils.badge(u.active ? 'Active' : 'Inactive')}</td>
            <td>${Utils.formatDateTime(u.lastLogin)}</td>
            <td class="actions-cell">
              <button class="btn btn-outline btn-sm" data-edit-user="${u.id}">Edit</button>
              <button class="btn btn-outline btn-sm" data-reset-pw="${u.id}">Reset PW</button>
              ${u.id !== Auth.getCurrentUser().id ? `<button class="btn btn-sm ${u.active ? 'btn-warning' : 'btn-success'}" data-toggle-active="${u.id}">${u.active ? 'Deactivate' : 'Activate'}</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div></div>`;

    document.getElementById('btn-add-user').onclick = () => showUserModal();
    el.querySelectorAll('[data-edit-user]').forEach(b => b.onclick = () => showUserModal(b.dataset.editUser));
    el.querySelectorAll('[data-reset-pw]').forEach(b => b.onclick = () => showResetPwModal(b.dataset.resetPw));
    el.querySelectorAll('[data-toggle-active]').forEach(b => b.onclick = async () => {
      const user = await DB.get('users', b.dataset.toggleActive);
      if (!user) return;
      if (user.id === Auth.getCurrentUser().id) { toast('Error', 'Cannot deactivate yourself', 'error'); return; }
      const action = user.active ? 'deactivate' : 'activate';
      if (!(await confirm('Confirm', `${action} user ${user.name}?`))) return;
      user.active = !user.active;
      user.updatedAt = Utils.now();
      await DB.put('users', user);
      await Audit.logCurrent('User Updated', `User ${user.username} ${action}d`);
      toast('Updated', `User ${action}d`, 'success');
      navigate('users');
    });
  }

  async function showUserModal(userId) {
    const isEdit = !!userId;
    let user = null;
    if (isEdit) user = await DB.get('users', userId);

    openModal(`
      <div class="modal-header"><h2>${isEdit ? 'Edit User' : 'Add User'}</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Full Name <span class="required">*</span></label>
          <input class="form-control" id="u-name" value="${Utils.escapeHtml(user?.name || '')}" required></div>
        <div class="form-group"><label>Username <span class="required">*</span></label>
          <input class="form-control" id="u-username" value="${Utils.escapeHtml(user?.username || '')}" ${isEdit ? 'readonly' : ''} required></div>
        <div class="form-group"><label>Email</label>
          <input type="email" class="form-control" id="u-email" value="${Utils.escapeHtml(user?.email || '')}"></div>
        <div class="form-group"><label>Role <span class="required">*</span></label>
          <select class="form-control" id="u-role">
            ${Permissions.ROLES.map(r => `<option value="${r}" ${user?.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select></div>
        ${!isEdit ? `
        <div class="form-group"><label>Password <span class="required">*</span></label>
          <input type="password" class="form-control" id="u-pass" required minlength="6"></div>
        <div class="form-group"><label>Security Question</label>
          <select class="form-control" id="u-sq">
            <option value="">Select…</option>
            <option>What is your mother's maiden name?</option>
            <option>What was the name of your first pet?</option>
            <option>What city were you born in?</option>
            <option>What is your favorite book?</option>
          </select></div>
        <div class="form-group"><label>Security Answer</label>
          <input class="form-control" id="u-sa"></div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="u-save">Save</button>
      </div>`);

    document.getElementById('u-save').onclick = async () => {
      try {
        if (isEdit) {
          user.name = document.getElementById('u-name').value.trim();
          user.email = document.getElementById('u-email').value.trim();
          user.role = document.getElementById('u-role').value;
          user.updatedAt = Utils.now();
          await DB.put('users', user);
          await Audit.logCurrent('User Updated', `User ${user.username} updated`);
        } else {
          const username = document.getElementById('u-username').value.trim().toLowerCase();
          const existing = await DB.getOneByIndex('users', 'username', username);
          if (existing) throw new Error('Username already exists.');
          const password = document.getElementById('u-pass').value;
          if (password.length < 6) throw new Error('Password must be at least 6 characters.');
          const salt = Utils.generateSalt();
          const passwordHash = await Utils.hashPassword(password, salt);
          const newUser = {
            id: Utils.uid(),
            username,
            name: document.getElementById('u-name').value.trim(),
            email: document.getElementById('u-email').value.trim(),
            role: document.getElementById('u-role').value,
            active: true,
            passwordHash, salt,
            securityQuestion: document.getElementById('u-sq').value || '',
            securityAnswerHash: '',
            securityAnswerSalt: '',
            createdAt: Utils.now(),
            updatedAt: Utils.now(),
            lastLogin: null
          };
          const sa = document.getElementById('u-sa').value;
          if (newUser.securityQuestion && sa) {
            newUser.securityAnswerSalt = Utils.generateSalt();
            newUser.securityAnswerHash = await Utils.hashPassword(sa.trim().toLowerCase(), newUser.securityAnswerSalt);
          }
          await DB.add('users', newUser);
          await Audit.logCurrent('User Created', `User ${username} created with role ${newUser.role}`);
        }
        closeModal();
        toast('Saved', 'User saved successfully', 'success');
        navigate('users');
      } catch (err) { toast('Error', err.message, 'error'); }
    };
  }

  function showResetPwModal(userId) {
    openModal(`
      <div class="modal-header"><h2>Reset Password</h2><button class="modal-close" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        <div class="form-group"><label>New Password <span class="required">*</span></label>
          <input type="password" class="form-control" id="rp-pass" minlength="6" required></div>
        <div class="form-group"><label>Confirm Password <span class="required">*</span></label>
          <input type="password" class="form-control" id="rp-confirm" required></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="rp-save">Reset</button>
      </div>`, { size: 'modal-sm' });
    document.getElementById('rp-save').onclick = async () => {
      const p = document.getElementById('rp-pass').value;
      const c = document.getElementById('rp-confirm').value;
      if (p !== c) { toast('Error', 'Passwords do not match', 'error'); return; }
      try {
        await Auth.resetPassword(userId, p);
        closeModal();
        toast('Reset', 'Password reset successfully', 'success');
      } catch (err) { toast('Error', err.message, 'error'); }
    };
  }

  /* ========== ACTIVITY LOG ========== */
  async function renderActivity(el) {
    if (!Permissions.canViewActivityLogs()) throw new Error('Permission denied.');
    const logs = await Audit.getAll(300);
    el.innerHTML = `
      <div class="page-header"><div><h1>Activity Log</h1><div class="subtitle">Append-only audit history</div></div></div>
      <div class="card"><div class="card-body">
        ${logs.length === 0 ? '<div class="empty-state"><p>No activity yet</p></div>' :
          `<div class="timeline">${logs.map(l => `
            <div class="timeline-item">
              <div class="tl-title">${Utils.escapeHtml(l.action)} ${l.leadId ? '· Lead' : ''}</div>
              <div class="tl-desc">${Utils.escapeHtml(l.description)}</div>
              <div class="tl-meta">${Utils.escapeHtml(l.userName)} (${Utils.escapeHtml(l.role)}) · ${Utils.formatDateTime(l.createdAt)}</div>
            </div>`).join('')}</div>`}
      </div></div>`;
  }

  /* ========== BACKUP ========== */
  async function renderBackup(el) {
    if (!Permissions.canBackup()) throw new Error('Permission denied.');
    el.innerHTML = `
      <div class="page-header"><div><h1>Backup & Restore</h1><div class="subtitle">Protect your CRM data</div></div></div>
      <div class="charts-grid">
        <div class="card">
          <div class="card-header"><h3>📦 JSON Full Backup</h3></div>
          <div class="card-body">
            <p class="mb-2 text-muted">Complete backup including all data and document attachments. Recommended for full disaster recovery.</p>
            <button class="btn btn-primary" id="btn-json-export">Download JSON Backup</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📥 JSON Restore</h3></div>
          <div class="card-body">
            <p class="mb-2 text-muted">Restore from a previously created JSON backup file.</p>
            <div class="form-group"><input type="file" class="form-control" id="restore-file" accept=".json"></div>
            <div class="form-group">
              <label class="form-check"><input type="radio" name="restore-mode" value="replace" checked> Replace Existing Data</label>
              <label class="form-check"><input type="radio" name="restore-mode" value="merge"> Merge / Import</label>
            </div>
            <button class="btn btn-warning" id="btn-json-restore">Restore</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📊 Spreadsheet Export</h3></div>
          <div class="card-body">
            <div class="setup-banner mb-2">Spreadsheet backup does not preserve binary document attachments. Use JSON Backup for complete backup including files.</div>
            <div class="flex gap-1" style="flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" data-csv="leads">Leads</button>
              <button class="btn btn-outline btn-sm" data-csv="payments">Payments</button>
              <button class="btn btn-outline btn-sm" data-csv="followups">Follow-ups</button>
              <button class="btn btn-outline btn-sm" data-csv="users">Users</button>
              <button class="btn btn-outline btn-sm" data-csv="activity">Activity</button>
              <button class="btn btn-outline btn-sm" data-csv="status_history">Status History</button>
              <button class="btn btn-outline btn-sm" data-csv="settings">Settings</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>📥 CSV Import (Leads)</h3></div>
          <div class="card-body">
            <p class="mb-2 text-muted">Import leads from CSV. Requires Customer and Mobile columns.</p>
            <div class="form-group"><input type="file" class="form-control" id="csv-import-file" accept=".csv"></div>
            <button class="btn btn-outline" id="btn-csv-import">Import Leads CSV</button>
          </div>
        </div>
      </div>`;

    document.getElementById('btn-json-export').onclick = async () => {
      try {
        await Backup.exportJSON();
        toast('Backup Created', 'JSON backup downloaded', 'success');
      } catch (err) { toast('Error', err.message, 'error'); }
    };

    document.getElementById('btn-json-restore').onclick = async () => {
      const file = document.getElementById('restore-file').files[0];
      if (!file) { toast('Error', 'Select a backup file', 'error'); return; }
      const mode = document.querySelector('input[name="restore-mode"]:checked').value;
      const msg = mode === 'replace'
        ? 'This will REPLACE all existing data with the backup. This cannot be undone.'
        : 'This will merge backup data with existing records (overwrite by ID).';
      if (!(await confirm('Confirm Restore', msg, 'Make sure you have a current backup first.'))) return;
      try {
        const result = await Backup.importJSON(file, mode);
        toast('Restored', `Data restored (${result.mode}). Reloading…`, 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (err) { toast('Error', err.message, 'error'); }
    };

    el.querySelectorAll('[data-csv]').forEach(b => {
      b.onclick = async () => {
        try {
          await Backup.exportCSV(b.dataset.csv);
          toast('Exported', `${b.dataset.csv} CSV downloaded`, 'success');
        } catch (err) { toast('Error', err.message, 'error'); }
      };
    });

    document.getElementById('btn-csv-import').onclick = async () => {
      const file = document.getElementById('csv-import-file').files[0];
      if (!file) { toast('Error', 'Select a CSV file', 'error'); return; }
      try {
        const result = await Backup.importCSV('leads', file);
        toast('Imported', `${result.imported} leads imported`, 'success');
      } catch (err) { toast('Error', err.message, 'error'); }
    };
  }

  /* ========== SETTINGS ========== */
  async function renderSettings(el) {
    const u = Auth.getCurrentUser();
    const isAdmin = Permissions.isAdmin();
    const settings = {
      companyName: await DB.getSetting('companyName', 'LeadFlow CRM'),
      companyAddress: await DB.getSetting('companyAddress', ''),
      companyPhone: await DB.getSetting('companyPhone', ''),
      companyEmail: await DB.getSetting('companyEmail', ''),
      sessionTimeout: await DB.getSetting('sessionTimeout', 30),
      maxUploadSize: await DB.getSetting('maxUploadSize', 5),
      theme: await DB.getSetting('theme', 'light'),
      browserNotifications: await DB.getSetting('browserNotifications', true),
      followupReminderHours: await DB.getSetting('followupReminderHours', 24),
      paymentReminderDays: await DB.getSetting('paymentReminderDays', 3)
    };

    el.innerHTML = `
      <div class="page-header"><div><h1>Settings</h1></div></div>
      <div class="settings-layout">
        <div class="card" style="height:fit-content">
          <div class="card-body settings-nav" id="settings-nav">
            <button class="active" data-spanel="profile">Profile</button>
            <button data-spanel="appearance">Appearance</button>
            <button data-spanel="notifications">Notifications</button>
            ${isAdmin ? `<button data-spanel="security">Security</button>
            <button data-spanel="files">Files</button>
            <button data-spanel="company">Company</button>` : ''}
          </div>
        </div>
        <div>
          <div class="settings-panel active card" id="spanel-profile">
            <div class="card-header"><h3>Profile</h3></div>
            <div class="card-body">
              <div class="form-group"><label>Name</label><input class="form-control" id="s-name" value="${Utils.escapeHtml(u.name)}"></div>
              <div class="form-group"><label>Email</label><input class="form-control" id="s-email" value="${Utils.escapeHtml(u.email || '')}"></div>
              <div class="form-group"><label>Security Question</label>
                <select class="form-control" id="s-sq">
                  <option value="">Keep current</option>
                  <option>What is your mother's maiden name?</option>
                  <option>What was the name of your first pet?</option>
                  <option>What city were you born in?</option>
                  <option>What is your favorite book?</option>
                </select></div>
              <div class="form-group"><label>Security Answer (set new)</label><input class="form-control" id="s-sa"></div>
              <button class="btn btn-primary" id="s-save-profile">Save Profile</button>
              <hr class="mt-3 mb-2" style="border-color:var(--border)">
              <h4 class="mb-1">Change Password</h4>
              <div class="form-group"><label>Current Password</label><input type="password" class="form-control" id="s-curpass"></div>
              <div class="form-group"><label>New Password</label><input type="password" class="form-control" id="s-newpass"></div>
              <div class="form-group"><label>Confirm</label><input type="password" class="form-control" id="s-confpass"></div>
              <button class="btn btn-outline" id="s-change-pw">Change Password</button>
            </div>
          </div>
          <div class="settings-panel card" id="spanel-appearance">
            <div class="card-header"><h3>Appearance</h3></div>
            <div class="card-body">
              <div class="form-group"><label>Theme</label>
                <select class="form-control" id="s-theme">
                  <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
                  <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
                </select></div>
              <button class="btn btn-primary" id="s-save-appearance">Save</button>
            </div>
          </div>
          <div class="settings-panel card" id="spanel-notifications">
            <div class="card-header"><h3>Notifications</h3></div>
            <div class="card-body">
              <div class="form-group"><label class="form-check">
                <input type="checkbox" id="s-bnotif" ${settings.browserNotifications ? 'checked' : ''}> Browser Notifications</label></div>
              <div class="form-group"><label>Follow-up Reminder (hours before)</label>
                <input type="number" class="form-control" id="s-fuhours" value="${settings.followupReminderHours}" min="1"></div>
              <div class="form-group"><label>Payment Reminder (days before)</label>
                <input type="number" class="form-control" id="s-paydays" value="${settings.paymentReminderDays}" min="1"></div>
              <button class="btn btn-primary" id="s-save-notif">Save</button>
            </div>
          </div>
          ${isAdmin ? `
          <div class="settings-panel card" id="spanel-security">
            <div class="card-header"><h3>Security</h3></div>
            <div class="card-body">
              <div class="form-group"><label>Session Timeout (minutes)</label>
                <input type="number" class="form-control" id="s-timeout" value="${settings.sessionTimeout}" min="5" max="480"></div>
              <button class="btn btn-primary" id="s-save-security">Save</button>
            </div>
          </div>
          <div class="settings-panel card" id="spanel-files">
            <div class="card-header"><h3>Files</h3></div>
            <div class="card-body">
              <div class="form-group"><label>Maximum Upload Size (MB)</label>
                <input type="number" class="form-control" id="s-maxupload" value="${settings.maxUploadSize}" min="1" max="50"></div>
              <button class="btn btn-primary" id="s-save-files">Save</button>
            </div>
          </div>
          <div class="settings-panel card" id="spanel-company">
            <div class="card-header"><h3>Company</h3></div>
            <div class="card-body">
              <div class="form-group"><label>CRM / Company Name</label>
                <input class="form-control" id="s-cname" value="${Utils.escapeHtml(settings.companyName)}"></div>
              <div class="form-group"><label>Address</label>
                <textarea class="form-control" id="s-caddr" rows="2">${Utils.escapeHtml(settings.companyAddress)}</textarea></div>
              <div class="form-group"><label>Phone</label>
                <input class="form-control" id="s-cphone" value="${Utils.escapeHtml(settings.companyPhone)}"></div>
              <div class="form-group"><label>Email</label>
                <input class="form-control" id="s-cemail" value="${Utils.escapeHtml(settings.companyEmail)}"></div>
              <button class="btn btn-primary" id="s-save-company">Save</button>
            </div>
          </div>` : ''}
        </div>
      </div>`;

    document.querySelectorAll('#settings-nav button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#settings-nav button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('spanel-' + btn.dataset.spanel)?.classList.add('active');
      };
    });

    document.getElementById('s-save-profile').onclick = async () => {
      try {
        const data = {
          name: document.getElementById('s-name').value,
          email: document.getElementById('s-email').value
        };
        const sq = document.getElementById('s-sq').value;
        const sa = document.getElementById('s-sa').value;
        if (sq && sa) { data.securityQuestion = sq; data.securityAnswer = sa; }
        await Auth.updateProfile(data);
        toast('Saved', 'Profile updated', 'success');
        renderSidebar();
      } catch (err) { toast('Error', err.message, 'error'); }
    };

    document.getElementById('s-change-pw').onclick = async () => {
      try {
        const np = document.getElementById('s-newpass').value;
        if (np !== document.getElementById('s-confpass').value) throw new Error('Passwords do not match');
        await Auth.changePassword(u.id, document.getElementById('s-curpass').value, np);
        toast('Changed', 'Password updated', 'success');
        document.getElementById('s-curpass').value = '';
        document.getElementById('s-newpass').value = '';
        document.getElementById('s-confpass').value = '';
      } catch (err) { toast('Error', err.message, 'error'); }
    };

    document.getElementById('s-save-appearance').onclick = async () => {
      const theme = document.getElementById('s-theme').value;
      await DB.setSetting('theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      toast('Saved', 'Appearance updated', 'success');
    };

    document.getElementById('s-save-notif').onclick = async () => {
      await DB.setSetting('browserNotifications', document.getElementById('s-bnotif').checked);
      await DB.setSetting('followupReminderHours', Number(document.getElementById('s-fuhours').value));
      await DB.setSetting('paymentReminderDays', Number(document.getElementById('s-paydays').value));
      if (document.getElementById('s-bnotif').checked) await Notifications.requestBrowserPermission();
      toast('Saved', 'Notification settings updated', 'success');
    };

    document.getElementById('s-save-security')?.addEventListener('click', async () => {
      await DB.setSetting('sessionTimeout', Number(document.getElementById('s-timeout').value));
      toast('Saved', 'Security settings updated', 'success');
    });

    document.getElementById('s-save-files')?.addEventListener('click', async () => {
      await DB.setSetting('maxUploadSize', Number(document.getElementById('s-maxupload').value));
      toast('Saved', 'File settings updated', 'success');
    });

    document.getElementById('s-save-company')?.addEventListener('click', async () => {
      await DB.setSetting('companyName', document.getElementById('s-cname').value);
      await DB.setSetting('companyAddress', document.getElementById('s-caddr').value);
      await DB.setSetting('companyPhone', document.getElementById('s-cphone').value);
      await DB.setSetting('companyEmail', document.getElementById('s-cemail').value);
      toast('Saved', 'Company settings updated', 'success');
      // Refresh sidebar company name
      await showApp();
      navigate('settings');
    });
  }

  return {
    init, navigate, closeModal, toast, confirm, onSessionTimeout,
    viewLead, showStatusModal, showPaymentModal, showFollowupModal
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());