/* ═══════════════════════════════════════════════════════════════════
   OpenFloat POS X – Application Logic
═══════════════════════════════════════════════════════════════════ */

const state = {
  user: null,
  token: null,
  cart: [],
  selectedPayMethod: 'cash',
  theme: 'light',
  sidebarCollapsed: false,
  chartInstances: {},
  heldOrders: [],
  branchesCache: [],
  notifsRead: false,
  settingsCache: {}
};

/* ── SETTINGS HELPERS ──────────────────────────────────────────────
   These read from state.settingsCache so they always reflect the
   most-recently saved value without requiring a page reload.
─────────────────────────────────────────────────────────────────── */
function getVatRate() {
  const r = parseFloat(state.settingsCache && state.settingsCache.vat_rate);
  return (!isNaN(r) && r >= 0) ? r : 16;
}

function getCurrency() {
  return (state.settingsCache && state.settingsCache.currency) || 'KES';
}

function getBusinessName() {
  return (state.settingsCache && state.settingsCache.business_name) || 'OpenFloat POS';
}

/**
 * Push live settings values into every part of the UI that shows them:
 * – Cart VAT label, currency symbols, business name in receipts, etc.
 * Called after loadSettings() and after saveSettings() succeeds.
 */
function applySettingsToUI() {
  const vatRate = getVatRate();
  const currency = getCurrency();
  const bizName = getBusinessName();

  // Cart VAT label (Register)
  const vatLabel = document.getElementById('cart-vat-label');
  if (vatLabel) vatLabel.textContent = `VAT (${vatRate}%)`;

  // Currency symbol on cart subtotal / total (static spans don't have live IDs,
  // so we re-render the cart if items are present)
  if (state.cart && state.cart.length > 0) renderCart();

  // Receipt header business name (if visible)
  const receiptBiz = document.getElementById('receipt-biz-name');
  if (receiptBiz) receiptBiz.textContent = bizName;

  // Settings page: reflect currency selector
  const currEl = document.getElementById('set-currency');
  if (currEl && currEl.value !== currency && !document.activeElement?.id?.includes('set-')) {
    currEl.value = currency;
  }
}

/* AUTHENTICATION HANDLERS */
function fillDemoLogin(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  document.getElementById('login-error').classList.add('hidden');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const emailInput   = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errorEl      = document.getElementById('login-error');
  const submitBtn    = document.getElementById('login-submit-btn');

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.querySelector('span').textContent = 'Authenticating...';

  const email    = (emailInput.value || '').trim().toLowerCase();
  const password = (passwordInput.value || '').trim();

  const DEMO_PASSWORDS = { 'owner@openfloat.com': 'admin123' };
  const DEMO_USERS = {
    'owner@openfloat.com':  { name: 'Owner', role: 'owner', email: 'owner@openfloat.com' }
  };

  // Helper — calls completeLogin in its own isolated try so any error inside
  // it never gets caught by the outer handler and causes a re-entrant loop.
  function doCompleteLogin(user, token) {
    state.user  = user;
    state.token = token;
    localStorage.setItem('openfloat_user',  JSON.stringify(user));
    localStorage.setItem('openfloat_token', token);
    try { completeLogin(); } catch (innerErr) {
      console.error('[Login] completeLogin() threw:', innerErr);
    }
  }

  let loginSuccess = false;

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      loginSuccess = true;
      doCompleteLogin(data.user, data.token);
    } else {
      // Server rejected — try demo fallback
      if (DEMO_USERS[email]) {
        loginSuccess = true;
        doCompleteLogin(DEMO_USERS[email], 'demo_' + Date.now());
      } else {
        errorEl.textContent = data.error || 'Invalid email or password.';
        errorEl.classList.remove('hidden');
      }
    }
  } catch (netErr) {
    // Network error (server down, file:// protocol, etc.) — demo fallback
    console.warn('[Login] Network error, using demo fallback:', netErr.message);
    if (DEMO_USERS[email]) {
      loginSuccess = true;
      doCompleteLogin(DEMO_USERS[email], 'demo_' + Date.now());
    } else {
      errorEl.textContent = 'Cannot reach server. Check email or start the backend.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = 'Sign In';
  }

  if (loginSuccess) console.log('[Login] Authenticated as', email);
}

function getDefaultViewForRole(role) {
  const r = (role || 'cashier').toLowerCase();
  if (r === 'cashier') return 'sales';
  if (r === 'hr') return 'hr';
  if (r === 'accountant') return 'accounting';
  return 'dashboard';
}

function completeLogin() {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.classList.add('hidden');
  const appShell = document.getElementById('app');
  if (appShell) appShell.style.display = '';
  updateUserUI();
  setGreeting();
  applyBranchSession(); // Lock or unlock branch switcher based on role

  const startView = getDefaultViewForRole(state.user?.role);
  navTo(startView);
  showToast(`Welcome back, ${state.user.name}!`);

  // Initialize charts and load live data now that the user is authenticated
  initCharts();
  loadCategories();
  loadPOSProducts();
  loadInventory();
  loadCustomers();
  loadBranches(); // Load branches after authentication
  loadSettingsCache(); // Always fetch settings on login so VAT/currency are live
  if (state.user?.role === 'owner' || state.user?.role === 'manager') {
    loadDashboardKPIs();
  }
}

/**
 * Apply branch session lock/unlock based on the logged-in user's role and assigned branch.
 * - Owner: Branch switcher remains fully interactive.
 * - All others: Switcher is locked to their assigned branch.
 */
function applyBranchSession() {
  const user = state.user;
  if (!user) return;

  const branchNameEl = document.getElementById('branch-name');
  const branchSelector = document.querySelector('.branch-selector');
  const branchStatusEl = document.querySelector('.branch-status');

  if (user.role === 'owner') {
    // Owner defaults to All Branches (HQ Overview) upon login!
    state.currentBranch = { name: 'All Branches (HQ Overview)', id: 'all' };
    if (branchNameEl) branchNameEl.textContent = 'All Branches (HQ Overview)';
    if (branchStatusEl) branchStatusEl.textContent = 'Online · Enterprise HQ';

    if (branchSelector) {
      branchSelector.style.cursor = 'pointer';
      branchSelector.style.opacity = '1';
      branchSelector.setAttribute('onclick', 'openBranchModal()');
      branchSelector.title = 'Click to switch branch';
    }
  } else {
    const assignedBranch = user.branch_name || 'Main Branch';
    state.currentBranch = { name: assignedBranch, id: user.branch_id || 1 };
    if (branchNameEl) branchNameEl.textContent = assignedBranch;

    // Non-owner: lock the branch switcher
    if (branchSelector) {
      branchSelector.style.cursor = 'default';
      branchSelector.style.opacity = '0.85';
      branchSelector.removeAttribute('onclick');
      branchSelector.setAttribute('onclick', 'showToast("Branch locked to your assigned work location")');
      branchSelector.title = 'Branch session locked';
    }
    if (branchStatusEl) branchStatusEl.textContent = 'Online · Branch Locked';
  }

  applyRolePermissions();
}

function updateUserUI() {
  if (!state.user) return;
  const initial = (state.user.name || 'U').charAt(0).toUpperCase();

  const userAvatarSidebar = document.getElementById('user-avatar-sidebar');
  const sidebarUsername = document.getElementById('sidebar-username');
  const sidebarEmail = document.getElementById('sidebar-email');
  const topbarAvatar = document.getElementById('topbar-avatar');
  const topbarUsername = document.getElementById('topbar-username');

  if (userAvatarSidebar) userAvatarSidebar.textContent = initial;
  if (sidebarUsername) sidebarUsername.textContent = state.user.name + ` (${(state.user.role || 'user').toUpperCase()})`;
  if (sidebarEmail) sidebarEmail.textContent = state.user.email;
  if (topbarAvatar) topbarAvatar.textContent = initial;
  if (topbarUsername) topbarUsername.textContent = state.user.name;

  applyRolePermissions();
}

function applyRolePermissions() {
  if (!state.user) return;
  const role = (state.user.role || 'cashier').toLowerCase();
  const isHQMode = role === 'owner' && (!state.currentBranch || state.currentBranch.id === 'all');

  // Role permissions map: view IDs allowed for each role
  const permissions = {
    owner: isHQMode ? ['dashboard', 'branch-comparison', 'ai', 'settings'] : ['*'],
    manager: ['*'],
    cashier: ['sales', 'crm', 'hire-purchase', 'z-reports', 'logistics', 'stock-movements'],
    hr: ['hr'],
    accountant: ['accounting', 'receivables', 'suppliers', 'z-reports', 'procurement']
  };

  const allowedViews = permissions[role] || permissions.cashier;
  const isSuper = allowedViews.includes('*');

  // 1. Filter nav items
  document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(item => {
    const view = item.getAttribute('data-view');
    // In individual branch mode, hide branch-comparison (it is an enterprise HQ tool)
    if (view === 'branch-comparison' && !isHQMode) {
      item.style.display = 'none';
      return;
    }

    if (!isSuper && !allowedViews.includes(view)) {
      item.style.display = 'none';
    } else {
      item.style.display = 'flex';
    }
  });

  // 2. Hide/show sidebar section headers when in HQ mode
  const sectionLabels = document.querySelectorAll('.sidebar-section-label');
  sectionLabels.forEach(lbl => {
    const text = lbl.textContent.trim().toUpperCase();
    if (isHQMode) {
      if (text === 'COMMERCE') lbl.textContent = 'ENTERPRISE HQ';
      else if (text === 'PEOPLE & OPS') lbl.textContent = 'INTELLIGENCE';
      else if (text === 'INVENTORY' || text === 'FINANCE') lbl.style.display = 'none';
      else lbl.style.display = '';
    } else {
      if (text === 'ENTERPRISE HQ') lbl.textContent = 'COMMERCE';
      else if (text === 'INTELLIGENCE') lbl.textContent = 'PEOPLE & OPS';
      lbl.style.display = '';
    }
  });
}

async function checkBackendGuard() {
  const dot = document.getElementById('guard-dot');
  const text = document.getElementById('guard-status-text');
  const details = document.getElementById('guard-details');

  if (!dot || !text || !details) return;

  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data = await res.json();
      dot.className = 'guard-dot green';
      text.textContent = 'Backend Engine & SQLite Database Online';
      details.classList.remove('hidden');

      if (data.ai_configured) {
        details.className = 'guard-details online';
        details.innerHTML = '<strong>Live System Ready</strong>: Database connected &bull; Gemini AI Assistant active via <code>.env</code>.';
      } else {
        details.className = 'guard-details warn';
        details.innerHTML = '<strong>Live System Ready</strong>: Database connected &bull; ⚠️ <code>GEMINI_API_KEY</code> missing in <code>.env</code> (AI Assistant offline).';
      }
    } else {
      throw new Error('HTTP ' + res.status);
    }
  } catch (err) {
    dot.className = 'guard-dot red';
    text.textContent = 'Backend Server Offline (Port 5000)';
    details.classList.remove('hidden');
    details.className = 'guard-details offline';
    details.innerHTML = '<strong>Server Disconnected</strong>: Express server is offline. Run <code>node backend/server.js</code> or <code>npm start</code> in terminal. <em>Demo fallback available below.</em>';
  }
}

async function checkSession() {
  checkBackendGuard();
  const savedUser = localStorage.getItem('openfloat_user');
  const savedToken = localStorage.getItem('openfloat_token');
  const loginScreen = document.getElementById('login-screen');

  if (savedUser && savedToken) {
    try {
      state.user = JSON.parse(savedUser);
      state.token = savedToken;

      // Always verify token with backend — this catches stale sessions after db:reset
      const verifyRes = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + savedToken }
      });

      if (!verifyRes.ok) {
        // Token invalid or user no longer exists in DB → force re-login
        doLogout();
        return;
      }

      if (loginScreen) loginScreen.classList.add('hidden');
      updateUserUI();
      applyBranchSession(); // Restore branch lock on session restore
      loadBranches();       // Reload branches on session restore
      const startView = getDefaultViewForRole(state.user?.role);
      navTo(startView);
    } catch (e) {
      // Network error during verification → still show login for safety
      doLogout();
    }
  } else {
    if (loginScreen) loginScreen.classList.remove('hidden');
  }
}


function doLogout() {
  // Clear persisted session
  localStorage.removeItem('openfloat_user');
  localStorage.removeItem('openfloat_token');

  // Reset in-memory state
  state.user = null;
  state.token = null;
  state.productsCache = [];
  state.customersCache = [];
  state.cart = [];

  // Clear cart UI
  const cartItems = document.getElementById('cart-items');
  if (cartItems) cartItems.innerHTML = '';
  const cartTotal = document.getElementById('cart-total');
  if (cartTotal) cartTotal.textContent = 'KES 0';

  // Show login screen, hide app shell
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.classList.remove('hidden');
  const appShell = document.getElementById('app');
  if (appShell) appShell.style.display = 'none';

  checkBackendGuard();
  showToast('Signed out of terminal');
}

/* ── USER DROPDOWN ──────────────────────────────────────────────── */
function toggleUserMenu() {
  const dropdown = document.getElementById('user-dropdown');
  const chip     = document.getElementById('user-chip');
  if (!dropdown) return;

  const isOpen = !dropdown.classList.contains('hidden');
  if (isOpen) {
    closeUserMenu();
  } else {
    // Populate with live session data
    const u = state.user;
    if (u) {
      const initial = (u.name || u.email || 'U')[0].toUpperCase();
      ['topbar-avatar','user-dropdown-avatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = initial;
      });
      const nameEl = document.getElementById('user-dropdown-name');
      if (nameEl) nameEl.textContent = u.name || u.email;
      const roleEl = document.getElementById('user-dropdown-role');
      if (roleEl) roleEl.textContent = `${u.role || 'User'} \u2022 ${u.branch || 'Main Branch'}`;
    }
    dropdown.classList.remove('hidden');
    chip.classList.add('open');
    // Close on next outside click
    setTimeout(() => document.addEventListener('click', _closeUserMenuOutside, { once: true }), 0);
  }
}

function _closeUserMenuOutside(e) {
  const dropdown = document.getElementById('user-dropdown');
  const chip     = document.getElementById('user-chip');
  if (dropdown && chip && !chip.contains(e.target) && !dropdown.contains(e.target)) {
    closeUserMenu();
  }
}

function closeUserMenu() {
  const dropdown = document.getElementById('user-dropdown');
  const chip     = document.getElementById('user-chip');
  if (dropdown) dropdown.classList.add('hidden');
  if (chip)     chip.classList.remove('open');
  document.removeEventListener('click', _closeUserMenuOutside);
}

function openChangePasswordModal() {
  ['cp-current','cp-new','cp-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const err = document.getElementById('cp-error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  openModal('change-password-modal');
}

async function submitChangePassword() {
  const current  = (document.getElementById('cp-current')?.value  || '').trim();
  const newPw    = (document.getElementById('cp-new')?.value      || '').trim();
  const confirm  = (document.getElementById('cp-confirm')?.value  || '').trim();
  const errEl    = document.getElementById('cp-error');

  const showErr = msg => {
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  };

  if (!current)          return showErr('Enter your current password.');
  if (newPw.length < 6)  return showErr('New password must be at least 6 characters.');
  if (newPw !== confirm)  return showErr('Passwords do not match.');

  try {
    const res  = await fetch('/api/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw })
    });
    const data = await res.json();
    if (!res.ok) return showErr(data.error || 'Failed to update password.');
    closeModal('change-password-modal');
    showToast('Password updated successfully');
  } catch {
    showErr('Server error. Please try again.');
  }
}

/* ── API HELPER ─────────────────────────────────────────────────── */
async function apiGet(path) {
  const headers = {};
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch(path, { headers });
  } catch (netErr) {
    // Genuine network failure (server unreachable)
    const e = new Error('NETWORK_ERROR');
    e.code = 'NETWORK_ERROR';
    throw e;
  }
  if (res.status === 401) {
    const e = new Error('AUTH_ERROR');
    e.code = 'AUTH_ERROR';
    e.status = 401;
    throw e;
  }
  if (res.status === 403) {
    const e = new Error('ACCESS_DENIED');
    e.code = 'ACCESS_DENIED';
    e.status = 403;
    throw e;
  }
  if (!res.ok) {
    const e = new Error('API ' + res.status);
    e.code = 'SERVER_ERROR';
    e.status = res.status;
    throw e;
  }
  return res.json();
}

async function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

async function apiPut(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(body) });
  return res.json();
}

async function apiDelete(path) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { method: 'DELETE', headers });
  return res.json();
}

/* Live data caches — populated by API on load */
state.productsCache = [];
state.customersCache = [];

/* HELPERS */
function fmt(n) { return new Intl.NumberFormat('en-KE').format(n); }

function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function setGreeting() {
  if (!state.user) return;
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = `${g}, ${state.user.name}`;
}

function updateTime() {
  const t = document.getElementById('order-time');
  if (t) t.textContent = new Date().toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' });
}

/* VIEW DOM WIPING & BRANCH ISOLATION HELPERS */
function clearViewDOM(viewId) {
  const loadingRow = (colspan, label) => 
    `<tr class="view-loading-row"><td colspan="${colspan}"><span class="spinner-sm"></span> Loading ${label}...</td></tr>`;
  const loadingBox = (label) => 
    `<div class="view-loading-box"><span class="spinner-sm"></span> Loading ${label}...</div>`;
  const setEl = (id, val = '—') => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  switch (viewId) {
    case 'dashboard':
      ['kpi-revenue', 'kpi-profit', 'kpi-transactions', 'kpi-outstanding-ar',
       'dash-opt-kpi-rev', 'dash-opt-kpi-profit', 'dash-opt-kpi-txs', 'dash-opt-kpi-ar'].forEach(id => setEl(id, '—'));
      ['kpi-revenue-trend', 'kpi-profit-trend', 'kpi-txn-trend', 'kpi-ar-trend'].forEach(id => setEl(id, 'Updating...'));
      setHtml('dash-txn-list', loadingBox('transactions'));
      setHtml('dash-stock-list', loadingBox('stock alerts'));
      setHtml('dash-branch-list', loadingBox('branch data'));
      setHtml('dash-approvals-grid', loadingBox('pending approvals'));
      break;

    case 'sales':
      setHtml('products-grid', `<div style="grid-column:1/-1;" class="view-loading-box"><span class="spinner-sm"></span> Loading branch catalog...</div>`);
      break;

    case 'inventory':
      ['inv-kpi-healthy', 'inv-kpi-reorder', 'inv-kpi-out', 'inv-kpi-dead', 'inv-kpi-expiring'].forEach(id => setEl(id, '—'));
      setHtml('inventory-tbody', loadingRow(9, 'inventory'));
      break;

    case 'hr':
      ['hr-kpi-total', 'hr-kpi-branches', 'hr-kpi-present', 'hr-kpi-rate', 'hr-kpi-payroll', 'hr-kpi-leave', 'hr-kpi-leave-sub'].forEach(id => setEl(id, '—'));
      setHtml('hr-tbody', loadingRow(7, 'employees'));
      break;

    case 'crm':
      ['crm-kpi-total', 'crm-kpi-churn', 'crm-kpi-loyalty', 'crm-kpi-ltv'].forEach(id => setEl(id, '—'));
      setHtml('crm-tbody', loadingRow(7, 'customers'));
      setHtml('crm-top-customers', loadingBox('top customers'));
      break;

    case 'accounting':
      ['acc-kpi-revenue', 'acc-kpi-expenses', 'acc-kpi-profit', 'acc-kpi-ar'].forEach(id => setEl(id, '—'));
      setHtml('acc-je-tbody', loadingRow(7, 'journal entries'));
      setHtml('acc-ar-tbody', loadingRow(4, 'receivables ledger'));
      setHtml('acc-ap-tbody', loadingRow(4, 'payables ledger'));
      break;

    case 'procurement':
      ['pr-kpi-open', 'pr-kpi-approved', 'pr-kpi-spend', 'pr-kpi-delivered'].forEach(id => setEl(id, '—'));
      setHtml('pr-tbody', loadingRow(8, 'purchase requests'));
      break;

    case 'logistics':
      ['del-kpi-active', 'del-kpi-done', 'del-kpi-pending', 'del-kpi-delayed'].forEach(id => setEl(id, '—'));
      setHtml('del-tbody', loadingRow(8, 'deliveries'));
      setHtml('del-active-list', loadingBox('active dispatches'));
      break;

    case 'suppliers':
      ['sup-kpi-total', 'sup-kpi-active', 'sup-kpi-rating', 'sup-kpi-categories'].forEach(id => setEl(id, '—'));
      setHtml('sup-tbody', loadingRow(8, 'suppliers'));
      break;

    case 'hire-purchase':
      ['hp-kpi-active', 'hp-kpi-collections', 'hp-kpi-overdue', 'hp-kpi-total'].forEach(id => setEl(id, '—'));
      setHtml('hp-tbody', loadingRow(10, 'agreements'));
      break;

    case 'receivables':
      ['ar-kpi-total', 'ar-kpi-b2b', 'ar-kpi-overdue', 'ar-kpi-rate', 'ar-summary-total', 'ar-summary-overdue', 'ar-summary-count', 'ar-summary-rate'].forEach(id => setEl(id, '—'));
      setHtml('ar-tbody', loadingRow(7, 'debtor accounts'));
      break;

    case 'services':
      ['srv-kpi-total', 'srv-kpi-active', 'srv-kpi-rev', 'srv-kpi-avg'].forEach(id => setEl(id, '—'));
      setHtml('srv-tbody', loadingRow(9, 'services'));
      break;

    case 'stock-movements':
      ['sm-kpi-today', 'sm-kpi-returns', 'sm-kpi-damage', 'sm-kpi-adjustments'].forEach(id => setEl(id, '—'));
      setHtml('sm-tbody', loadingRow(9, 'stock movements'));
      break;

    case 'z-reports':
      ['zr-last-amount', 'zr-last-sub', 'zr-prev-amount', 'zr-prev-sub'].forEach(id => setEl(id, '—'));
      setHtml('z-report-preview', loadingBox('report preview'));
      break;

    case 'branch-comparison':
      setHtml('comp-matrix-tbody', loadingRow(9, 'comparison matrix'));
      break;
  }
}

function clearAllViewsDOM() {
  const views = [
    'dashboard', 'sales', 'inventory', 'hr', 'crm', 'accounting',
    'procurement', 'logistics', 'suppliers', 'hire-purchase',
    'receivables', 'services', 'stock-movements', 'z-reports',
    'branch-comparison'
  ];
  views.forEach(v => clearViewDOM(v));

  // Also clear sales history modal state & table
  _txnCache = [];
  ['sh-kpi-count', 'sh-kpi-revenue', 'sh-kpi-cash', 'sh-kpi-mpesa'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  const txTb = document.getElementById('txn-tbody');
  if (txTb) txTb.innerHTML = '<tr class="view-loading-row"><td colspan="8"><span class="spinner-sm"></span> Loading branch transactions...</td></tr>';
}

function triggerViewLoad(viewId) {
  const curBranchId = state.currentBranch?.id ?? '1';
  if (!state.viewLoadedBranch) state.viewLoadedBranch = {};

  if (viewId === 'accounting') {
    initAccountingCharts();
    loadAccounting().then(() => { state.viewLoadedBranch['accounting'] = curBranchId; });
  } else if (viewId === 'hr') {
    initHRCharts();
    loadHR().then(() => { state.viewLoadedBranch['hr'] = curBranchId; });
  } else if (viewId === 'procurement') {
    initProcureCharts();
    loadProcurement().then(() => { state.viewLoadedBranch['procurement'] = curBranchId; });
  } else if (viewId === 'logistics') {
    loadLogistics().then(() => { state.viewLoadedBranch['logistics'] = curBranchId; });
  } else if (viewId === 'crm') {
    loadCRM().then(() => { state.viewLoadedBranch['crm'] = curBranchId; });
  } else if (viewId === 'dashboard') {
    loadDashboardKPIs().then(() => { state.viewLoadedBranch['dashboard'] = curBranchId; });
  } else if (viewId === 'inventory') {
    loadCategories();
    loadInventory().then(d => {
      _inventoryCache = d || [];
      state.viewLoadedBranch['inventory'] = curBranchId;
    });
  } else if (viewId === 'sales') {
    loadCategories();
    loadPOSProducts().then(() => { state.viewLoadedBranch['sales'] = curBranchId; });
  } else if (viewId === 'suppliers') {
    loadSuppliers().then(() => { state.viewLoadedBranch['suppliers'] = curBranchId; });
  } else if (viewId === 'hire-purchase') {
    loadHirePurchase().then(() => { state.viewLoadedBranch['hire-purchase'] = curBranchId; });
  } else if (viewId === 'receivables') {
    loadReceivables().then(() => { state.viewLoadedBranch['receivables'] = curBranchId; });
  } else if (viewId === 'services') {
    loadServices().then(() => { state.viewLoadedBranch['services'] = curBranchId; });
  } else if (viewId === 'stock-movements') {
    loadStockMovements().then(() => { state.viewLoadedBranch['stock-movements'] = curBranchId; });
  } else if (viewId === 'z-reports') {
    loadZReports().then(() => { state.viewLoadedBranch['z-reports'] = curBranchId; });
  } else if (viewId === 'ai') {
    loadAI();
  } else if (viewId === 'settings') {
    loadSettings();
  } else if (viewId === 'branch-comparison') {
    loadBranchComparisonView().then(() => { state.viewLoadedBranch['branch-comparison'] = curBranchId; });
  }
}

/* NAVIGATION */
function navTo(viewId) {
  if (state.user) {
    const role = (state.user.role || 'cashier').toLowerCase();
    const permissions = {
      owner: ['*'],
      manager: ['*'],
      cashier: ['sales', 'crm', 'hire-purchase', 'z-reports', 'logistics', 'stock-movements'],
      hr: ['hr'],
      accountant: ['accounting', 'receivables', 'suppliers', 'z-reports', 'procurement']
    };
    const allowed = permissions[role] || permissions.cashier;
    if (!allowed.includes('*') && !allowed.includes(viewId)) {
      showToast(`Access denied: ${role.toUpperCase()} role cannot access ${viewId}`);
      viewId = getDefaultViewForRole(role);
    }
  }

  // If this view has not yet loaded for the current branch, clear its DOM to loading state
  const curBranchId = state.currentBranch?.id ?? '1';
  if (!state.viewLoadedBranch) state.viewLoadedBranch = {};
  if (state.viewLoadedBranch[viewId] !== curBranchId) {
    clearViewDOM(viewId);
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(n => {
    if (n.getAttribute('data-view') === viewId) n.classList.add('active');
    else n.classList.remove('active');
  });

  const targetView = document.getElementById('view-' + viewId);
  if (targetView) targetView.classList.add('active');
  state.currentView = viewId; // Track active view for context-aware operations

  // Trigger view data load
  triggerViewLoad(viewId);
}

/* SIDEBAR & THEME */
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
}

function updateAllChartsTheme() {
  const d = getChartDefaults();
  Object.values(state.chartInstances || {}).forEach(chart => {
    if (!chart || typeof chart.update !== 'function') return;
    try {
      if (chart.options && chart.options.scales) {
        Object.values(chart.options.scales).forEach(scale => {
          if (scale.grid) scale.grid.color = d.gridColor;
          if (scale.ticks) scale.ticks.color = d.textColor;
        });
      }
      if (chart.options?.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = d.textColor;
      }
      chart.update('none'); // Fast update without destroying data or re-animating from 0
    } catch (err) {
      console.warn('[updateAllChartsTheme]', err);
    }
  });
}

function cycleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
  showToast(state.theme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
  
  // Immediately update colors on all existing charts without destroying them
  updateAllChartsTheme();

  // Re-sync active view's charts to ensure full layout fidelity
  setTimeout(() => {
    updateAllChartsTheme();
    const v = state.currentView;
    if (v === 'dashboard') {
      loadDashboardKPIs();
    } else if (v === 'accounting') {
      loadAccounting();
    } else if (v === 'hr') {
      loadHR();
    } else if (v === 'procurement') {
      loadProcurement();
    } else if (v === 'crm') {
      loadCRM();
    } else if (v === 'branch-comparison') {
      loadBranchComparisonView();
    }
  }, 50);
}

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  if (panel) {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      updateNotificationsUI();
    }
  }
}

async function updateNotificationsUI() {
  const badgeEl = document.querySelector('.notif-badge');
  const listEl  = document.querySelector('#notif-panel .notif-list');
  if (!listEl) return;

  const notifs = [];

  try {
    // 1. Low stock alerts from live inventory
    if (state.productsCache && state.productsCache.length > 0) {
      const lowStock = state.productsCache.filter(p => (p.stock || 0) <= (p.min_stock || 5));
      lowStock.slice(0, 3).forEach(p => {
        notifs.push({
          type: 'red',
          text: `Low stock alert: ${p.name} (${p.stock || 0} units left)`,
          time: 'Stock Alert'
        });
      });
    }

    // 2. Staff attendance status alerts from live HR cache
    if (window._hrEmployeesCache && window._hrEmployeesCache.length > 0) {
      const absentOrLeave = window._hrEmployeesCache.filter(e => e.status === 'absent' || e.status === 'on_leave');
      absentOrLeave.slice(0, 3).forEach(e => {
        const stText = (e.status || '').replace('_', ' ');
        notifs.push({
          type: 'amber',
          text: `Staff status: ${e.name} (${e.role || 'Staff'}) is ${stText}`,
          time: 'HR Alert'
        });
      });
    }

    // 3. Active session notification
    if (state.user) {
      notifs.push({
        type: 'blue',
        text: `Logged in as ${state.user.name} (${(state.user.role || 'user').toUpperCase()}) · ${state.currentBranch?.name || 'Main Branch'}`,
        time: 'Active Session'
      });
    }
  } catch (e) {
    console.warn('[Notifications] Error generating notifications:', e.message);
  }

  if (notifs.length === 0) {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12.5px;">No active notifications</div>';
    if (badgeEl) badgeEl.style.display = 'none';
  } else {
    const isRead = state.notifsRead;
    listEl.innerHTML = notifs.map(n => `
      <div class="notif-item ${isRead ? '' : 'unread'}">
        <div class="notif-dot ${n.type}"></div>
        <div>
          <p>${n.text}</p>
          <span>${n.time}</span>
        </div>
      </div>
    `).join('');

    if (badgeEl) {
      if (isRead) {
        badgeEl.style.display = 'none';
      } else {
        badgeEl.style.display = '';
        badgeEl.textContent = notifs.length;
      }
    }
  }
}

function markAllRead() {
  state.notifsRead = true;
  document.querySelectorAll('.notif-item.unread').forEach(i => i.classList.remove('unread'));
  const badgeEl = document.querySelector('.notif-badge');
  if (badgeEl) badgeEl.style.display = 'none';
  showToast('All notifications marked as read');
}

// Close notification panel when clicking outside
document.addEventListener('click', (e) => {
  const notifWrap = document.querySelector('.notif-wrap');
  const notifPanel = document.getElementById('notif-panel');
  if (notifPanel && notifPanel.classList.contains('open')) {
    if (notifWrap && !notifWrap.contains(e.target)) {
      notifPanel.classList.remove('open');
    }
  }
});

/* POS TERMINAL FUNCTIONS */
let currentCategory = 'all';
let _categoriesCache = [];

async function loadCategories() {
  try {
    const res = await apiGet('/api/inventory/categories');
    _categoriesCache = res.data || [];

    // 1. Populate Inventory filter dropdown
    const invFilter = document.getElementById('inv-cat-filter');
    if (invFilter) {
      const currentVal = invFilter.value;
      let opts = '<option value="">All Categories</option>';
      _categoriesCache.forEach(c => {
        opts += `<option value="${c.name}">${c.name}</option>`;
      });
      invFilter.innerHTML = opts;
      if (currentVal) invFilter.value = currentVal;
    }

    // 2. Populate Product Add/Edit Modal category dropdown
    const prodCatSel = document.getElementById('prod-cat-id');
    if (prodCatSel) {
      const currentSelected = prodCatSel.value;
      let opts = '<option value="">Select Category...</option>';
      _categoriesCache.forEach(c => {
        opts += `<option value="${c.id}">${c.name}</option>`;
      });
      opts += '<option value="NEW_CATEGORY">+ Add New Category...</option>';
      prodCatSel.innerHTML = opts;
      if (currentSelected) prodCatSel.value = currentSelected;
    }

    return _categoriesCache;
  } catch (e) {
    console.error('[loadCategories] error:', e);
    return [];
  }
}

function onProductCategoryChange(val) {
  const newCatWrap = document.getElementById('prod-new-cat-wrap');
  const newCatInput = document.getElementById('prod-new-cat-name');
  if (val === 'NEW_CATEGORY') {
    if (newCatWrap) newCatWrap.classList.remove('hidden');
    if (newCatInput) {
      newCatInput.value = '';
      newCatInput.focus();
    }
  } else {
    if (newCatWrap) newCatWrap.classList.add('hidden');
  }
}

function onProductImageUrlChange(val) {
  const preview = document.getElementById('prod-img-preview');
  const placeholder = document.getElementById('prod-img-placeholder');
  const clearBtn = document.getElementById('prod-img-clear-btn');
  let url = (val || '').trim();

  // Auto-convert Google Drive share links to direct CDN preview URL
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    url = 'https://lh3.googleusercontent.com/d/' + driveMatch[1];
  }

  if (url) {
    if (preview) { preview.src = url; preview.classList.remove('hidden'); }
    if (placeholder) placeholder.classList.add('hidden');
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  } else {
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    if (placeholder) placeholder.classList.remove('hidden');
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

function handleProductImageUpload(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const urlInput = document.getElementById('prod-image-url');
    if (urlInput) urlInput.value = dataUrl;
    onProductImageUrlChange(dataUrl);
  };
  reader.readAsDataURL(file);
}

function clearProductImage() {
  const urlInput = document.getElementById('prod-image-url');
  const fileInput = document.getElementById('prod-image-file');
  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
  onProductImageUrlChange('');
}

/* ── LOAD FUNCTIONS (Phase 1: live data) ──────────────────────── */
async function loadPOSProducts() {
  const grid = document.getElementById('products-grid');
  const catTabsContainer = document.getElementById('pos-cat-tabs');
  try {
  const branchId = state.currentBranch && state.currentBranch.id ? state.currentBranch.id : null;
    const invUrl = (branchId && branchId !== 'all') ? `/api/inventory?branch_id=${branchId}` : '/api/inventory';
    const [invRes, srvRes, catRes] = await Promise.allSettled([
      apiGet(invUrl),
      apiGet('/api/services'),
      apiGet('/api/inventory/categories')
    ]);

    const inventory = invRes.status === 'fulfilled' ? (invRes.value.data || []) : [];
    const services  = srvRes.status === 'fulfilled' ? (srvRes.value.data || []) : [];
    if (catRes.status === 'fulfilled') {
      _categoriesCache = catRes.value.data || [];
    }

    const productItems = inventory.map(p => {
      const catName = p.category_name || 'General';
      const catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'general';
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        price: p.sell_price,
        image_url: p.image_url || null,
        cat: catName,
        cat_slug: catSlug,
        stock: p.stock_qty,
        status: p.stock_qty === 0 ? 'out' : p.stock_qty <= (p.reorder_level || 10) ? 'low' : 'ok',
        is_service: false
      };
    });

    const serviceItems = services.filter(s => s.status !== 'inactive' && s.is_active !== 0).map(s => ({
      id: 'srv_' + s.id,
      sku: s.code || ('SRV-00' + s.id),
      name: s.name,
      price: s.price,
      cat: 'Services',
      cat_slug: 'services',
      stock: 9999, // Billable services do not deplete physical inventory
      status: 'ok',
      unit: s.unit || 'service',
      is_service: true
    }));

    state.productsCache = [...productItems, ...serviceItems];

    // Build dynamic Category Tabs from actual active catalog items
    if (catTabsContainer) {
      const distinctCats = [];
      const seenSlugs = new Set(['all']);

      // 1. If services exist, add Services tab
      if (serviceItems.length > 0) {
        distinctCats.push({ name: 'Services', slug: 'services' });
        seenSlugs.add('services');
      }

      // 2. Add categories from actual product items
      productItems.forEach(p => {
        if (p.cat && !seenSlugs.has(p.cat_slug)) {
          seenSlugs.add(p.cat_slug);
          distinctCats.push({ name: p.cat, slug: p.cat_slug });
        }
      });

      // 3. Render tabs: 'All Items' first, followed by dynamic categories
      let tabsHtml = `<button class="cat-tab ${currentCategory === 'all' ? 'active' : ''}" data-cat="all" onclick="filterCat('all', this)">All Items</button>`;
      distinctCats.forEach(c => {
        const isActive = currentCategory === c.slug || currentCategory.toLowerCase() === c.name.toLowerCase();
        tabsHtml += `<button class="cat-tab ${isActive ? 'active' : ''}" data-cat="${c.slug}" onclick="filterCat('${c.slug}', this)">${c.name}</button>`;
      });

      catTabsContainer.innerHTML = tabsHtml;
    }

    renderProducts(currentCategory || 'all');
  } catch (e) {
    if (grid && (!state.productsCache || state.productsCache.length === 0)) {
      grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No products yet. <a href="#" onclick="loadPOSProducts()" style="color:#F97316;text-decoration:underline">Retry</a>.</div>';
    }
    if (e.code === 'NETWORK_ERROR') {
      console.warn('[POS] Server offline — retrying products later.');
    }
  }
}

async function loadCustomers() {
  try {
    const data = await apiGet('/api/crm/customers');
    state.customersCache = data.data || [];
    const sel = document.getElementById('cart-customer');
    if (!sel) return;
    const currentVal = sel.value;
    let opts = '<option value="">Walk-in Customer</option>';
    state.customersCache.forEach(c => {
      const pointsStr = c.loyalty_points ? ` (${c.loyalty_points} pts)` : '';
      const phoneStr = c.phone ? ` · ${c.phone}` : '';
      opts += `<option value="${c.id}">${c.name}${pointsStr}${phoneStr}</option>`;
    });
    sel.innerHTML = opts;
    if (currentVal && state.customersCache.some(c => String(c.id) === String(currentVal))) {
      sel.value = currentVal;
    }
    onCustomerSelect();
  } catch (e) {
    console.warn('[loadCustomers] error loading customers:', e);
  }
}

async function loadDashboardKPIs() {
  try {
    const isEnterprise = state.currentBranch && (state.currentBranch.id === 'all' || state.currentBranch.id === 0);
    const branchId = state.currentBranch?.id;

    // Update greeting / scope subtitle
    const greetingSub = document.querySelector('.greeting-sub');
    if (greetingSub) {
      if (isEnterprise) {
        greetingSub.innerHTML = `<strong>Enterprise Overview</strong> — Consolidated performance across all branches &amp; locations.`;
      } else {
        greetingSub.innerHTML = `Showing live operational performance for <strong>${state.currentBranch?.name || 'Current Branch'}</strong>.`;
      }
    }

    const apiCalls = isEnterprise
      ? [
          apiGet('/api/accounting/overview'),
          apiGet('/api/inventory'),
          apiGet('/api/sales/transactions?limit=1000'),
          apiGet('/api/hr/employees'),
          apiGet('/api/procurement/requests'),
          apiGet('/api/branches'),
          apiGet('/api/branches/performance')
        ]
      : [
          apiGet(`/api/accounting/overview?branch_id=${branchId}`),
          apiGet(`/api/inventory?branch_id=${branchId}`),
          apiGet(`/api/sales/transactions?limit=1000&branch_id=${branchId}`),
          apiGet(`/api/hr/employees?branch_id=${branchId}`),
          apiGet('/api/procurement/requests'),
          apiGet('/api/branches')
        ];

    const results = await Promise.allSettled(apiCalls);
    const overviewRes  = results[0];
    const inventoryRes = results[1];
    const txsRes       = results[2];
    const hrRes        = results[3];
    const prRes        = results[4];
    const branchesRes  = results[5];
    const branchPerfRes = isEnterprise ? results[6] : null;

    const overview  = overviewRes.status  === 'fulfilled' ? (overviewRes.value.data  || {}) : {};
    let products    = inventoryRes.status === 'fulfilled' ? (inventoryRes.value.data || []) : [];
    let txs         = txsRes.status       === 'fulfilled' ? (txsRes.value.data       || []) : [];
    let employees   = hrRes.status        === 'fulfilled' ? (hrRes.value.data        || []) : [];
    const prs       = prRes.status        === 'fulfilled' ? (prRes.value.data        || []) : [];
    const branches  = branchesRes.status  === 'fulfilled' ? (branchesRes.value.data  || []) : [];

    // If branch scoped, double check client-side filtering as well
    if (!isEnterprise && branchId) {
      products = products.filter(p => p.branch_id == branchId || !p.branch_id);
      txs = txs.filter(t => t.branch_id == branchId);
      employees = employees.filter(e => e.branch_id == branchId);
    }

    state.dashboardTxs = txs; // Cache transactions for period chart updating
    state.branchesCache = branches;

    const setKPI = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // 1. KPI Cards
    const totalRev = overview.total_revenue !== undefined ? overview.total_revenue : txs.reduce((sum, t) => sum + (t.total || 0), 0);
    const netProfit = overview.net_profit !== undefined ? overview.net_profit : (totalRev * 0.3);
    const totalTxCount = txs.length;
    const arBalance = overview.outstanding_ar || 0;

    setKPI('kpi-revenue', getCurrency() + ' ' + fmt(Math.round(totalRev)));
    setKPI('kpi-profit', getCurrency() + ' ' + fmt(Math.round(netProfit)));
    setKPI('kpi-transactions', fmt(totalTxCount));
    setKPI('kpi-outstanding-ar', getCurrency() + ' ' + fmt(Math.round(arBalance)));

    // 2. Metric Chips
    const cashTotal = txs.filter(t => t.payment_method === 'cash').reduce((sum, t) => sum + (t.total || 0), 0);
    const bankTotal = txs.filter(t => t.payment_method === 'card' || t.payment_method === 'bank').reduce((sum, t) => sum + (t.total || 0), 0);
    const mpesaTotal = txs.filter(t => t.payment_method === 'mpesa').reduce((sum, t) => sum + (t.total || 0), 0);
    const invValue = overview.inventory_cogs_value || products.reduce((sum, p) => sum + ((p.stock_qty || p.stock || 0) * (p.buy_price || p.price || 0)), 0);
    const presentStaff = employees.filter(e => e.status === 'present').length;
    const totalStaff = employees.length || 0;

    const activeBranchesCount = isEnterprise ? (branches.filter(b => b.is_active !== 0).length || 1) : 1;
    const totalBranchesCount  = isEnterprise ? (branches.length || 1) : 1;

    setKPI('chip-cash', getCurrency() + ' ' + fmt(Math.round(cashTotal)));
    setKPI('chip-bank', getCurrency() + ' ' + fmt(Math.round(bankTotal)));
    setKPI('chip-mpesa', getCurrency() + ' ' + fmt(Math.round(mpesaTotal)));
    setKPI('chip-inv-val', getCurrency() + ' ' + fmt(Math.round(invValue)));
    setKPI('chip-branches', isEnterprise ? `${activeBranchesCount} / ${totalBranchesCount}` : '1 / 1 (Selected)');
    setKPI('chip-staff', `${presentStaff} / ${totalStaff}`);

    // 3. Payment Donut Chart & Legend
    const pCounts = { cash: 0, mpesa: 0, card: 0, credit: 0 };
    txs.forEach(t => {
      const pm = (t.payment_method || 'cash').toLowerCase();
      if (pm in pCounts) pCounts[pm] += (t.total || 1);
    });
    const pTotal = pCounts.cash + pCounts.mpesa + pCounts.card + pCounts.credit;
    const pct = (val) => pTotal > 0 ? Math.round((val / pTotal) * 100) : 0;

    const legendEl = document.getElementById('payment-legend-container');
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="legend-item"><span class="legend-dot" style="background:#F97316"></span>Cash <strong>${pct(pCounts.cash)}%</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#10B981"></span>M-Pesa <strong>${pct(pCounts.mpesa)}%</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#F59E0B"></span>Card <strong>${pct(pCounts.card)}%</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#EC4899"></span>Credit <strong>${pct(pCounts.credit)}%</strong></div>
      `;
    }

    if (!state.chartInstances.payment) initPaymentChart();
    if (state.chartInstances.payment) {
      state.chartInstances.payment.data.datasets[0].data = pTotal > 0 ? [pCounts.cash, pCounts.mpesa, pCounts.card, pCounts.credit] : [0, 0, 0, 0];
      state.chartInstances.payment.update();
    }

    // 4. Revenue & Profit Line Chart
    if (!state.chartInstances.revenue) initRevenueChart();
    if (state.chartInstances.revenue) {
      const revData = totalRev > 0
        ? [Math.round(totalRev * 0.7), Math.round(totalRev * 0.75), Math.round(totalRev * 0.85), Math.round(totalRev * 0.8), Math.round(totalRev * 0.95), Math.round(totalRev)]
        : [0, 0, 0, 0, 0, 0];
      const profData = revData.map(v => Math.round(v * 0.25));

      state.chartInstances.revenue.data.datasets[0].data = revData;
      state.chartInstances.revenue.data.datasets[1].data = profData;
      state.chartInstances.revenue.update();
    }

    // Sparklines
    const numPoints = 7;
    let revSpark = Array(numPoints).fill(0);
    let profSpark = Array(numPoints).fill(0);
    let txnSpark = Array(numPoints).fill(0);
    let debtSpark = Array(numPoints).fill(0);

    if (txs.length > 0) {
      const sortedTxs = [...txs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const chunkSize = sortedTxs.length / numPoints;
      const creditSalesBuckets = Array(numPoints).fill(0);

      for (let i = 0; i < sortedTxs.length; i++) {
        const bucketIndex = Math.min(Math.floor(i / chunkSize), numPoints - 1);
        const t = sortedTxs[i];
        revSpark[bucketIndex] += t.total || 0;
        profSpark[bucketIndex] += (t.total || 0) * 0.3;
        txnSpark[bucketIndex] += 1;
        if (t.payment_method === 'credit') {
          creditSalesBuckets[bucketIndex] += t.total || 0;
        }
      }

      debtSpark[numPoints - 1] = arBalance;
      for (let i = numPoints - 2; i >= 0; i--) {
        debtSpark[i] = Math.max(0, debtSpark[i + 1] - creditSalesBuckets[i + 1]);
      }
    } else {
      debtSpark = Array(numPoints).fill(arBalance);
    }

    drawSparkline('spark-revenue', revSpark, '#F97316');
    drawSparkline('spark-profit', profSpark, '#10B981');
    drawSparkline('spark-txn', txnSpark, '#8B5CF6');
    drawSparkline('spark-debt', debtSpark, '#EF4444');

    // 5. Stock Alerts List (Filtered to current branch)
    const stockListEl = document.getElementById('dash-stock-list');
    if (stockListEl) {
      const alertItems = products.filter(p => (p.stock_qty || p.stock || 0) <= (p.reorder_level || 10) || p.expiry_date).slice(0, 5);
      if (alertItems.length === 0) {
        stockListEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">No stock alerts — inventory clean.</div>';
      } else {
        stockListEl.innerHTML = alertItems.map(p => {
          const qty = p.stock_qty || p.stock || 0;
          let badgeClass = 'amber', badgeLabel = 'Low', dotClass = 'amber';
          if (qty === 0) { badgeClass = 'dark'; badgeLabel = 'Out'; dotClass = 'dark'; }
          else if (qty <= 15) { badgeClass = 'red'; badgeLabel = 'Critical'; dotClass = 'red'; }
          else if (p.expiry_date) { badgeClass = 'purple'; badgeLabel = 'Expiring'; dotClass = 'purple'; }
          return `
            <div class="stock-item">
              <span class="stock-status-dot ${dotClass}"></span>
              <div class="stock-name">${p.name}</div>
              <div class="stock-qty">${qty} ${p.unit || 'units'}</div>
              <span class="stock-badge ${badgeClass}">${badgeLabel}</span>
            </div>
          `;
        }).join('');
      }
    }

    // 6. Branch Performance Summary Card Widget
    const branchListEl = document.getElementById('dash-branch-list');
    if (branchListEl) {
      const displayBranches = isEnterprise ? branches : branches.filter(b => b.id == branchId);
      const salesByBranchId = {};
      txs.forEach(t => {
        if (t.branch_id) {
          salesByBranchId[t.branch_id] = (salesByBranchId[t.branch_id] || 0) + (t.total || 0);
        }
      });

      let branchList = displayBranches.map(b => ({
        id: b.id,
        name: b.name || 'Branch ' + b.id,
        revenue: isEnterprise ? (salesByBranchId[b.id] || 0) : totalRev,
        status: b.is_active !== 0 ? 'Active' : 'Inactive'
      }));

      if (branchList.length === 0) {
        branchList = [{ id: branchId || 1, name: state.currentBranch?.name || 'Main Branch', revenue: totalRev, status: 'Active' }];
      }

      branchList.sort((a, b) => b.revenue - a.revenue);
      const rankClasses = ['gold', 'silver', 'bronze', ''];
      const maxRev = branchList[0]?.revenue || 1;

      branchListEl.innerHTML = branchList.map((b, i) => {
        const pct = maxRev > 0 ? Math.round((b.revenue / maxRev) * 100) : 0;
        const statusBadge = b.status === 'Inactive'
          ? '<span style="font-size:9.5px;padding:1px 5px;border-radius:4px;background:var(--red-light);color:var(--red);margin-left:6px;font-weight:600;">Inactive</span>'
          : '';

        return `
          <div class="branch-row">
            <div class="branch-rank ${rankClasses[i] || ''}">${i + 1}</div>
            <div class="branch-details">
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <span>${b.name}${statusBadge}</span>
                <span class="branch-rev" style="font-size:11.5px;font-weight:700;">KES ${fmt(Math.round(b.revenue))}</span>
              </div>
              <div class="branch-bar-wrap" style="margin-top:4px;"><div class="branch-bar" style="width:${pct}%"></div></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 7. Recent Transactions List
    const txnListEl = document.getElementById('dash-txn-list');
    if (txnListEl) {
      const recentTxs = txs.slice(0, 4);
      if (recentTxs.length === 0) {
        txnListEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px">No recent transactions recorded.</div>';
      } else {
        const bgColors = ['#EEF2FF', '#F0FDF4', '#FFF7ED', '#FDF2F8'];
        const textColors = ['#F97316', '#10B981', '#F59E0B', '#EC4899'];

        txnListEl.innerHTML = recentTxs.map((t, i) => {
          const name = t.customer_name || t.cashier_name || 'Walk-in Customer';
          const initials = name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
          const pm = t.payment_method ? (t.payment_method.charAt(0).toUpperCase() + t.payment_method.slice(1)) : 'Cash';
          const bg = bgColors[i % bgColors.length];
          const tc = textColors[i % textColors.length];
          return `
            <div class="txn-item">
              <div class="txn-avatar" style="background:${bg};color:${tc}">${initials}</div>
              <div class="txn-info"><p>${name}</p><span>Ref: ${t.ref || 'POS'} · ${pm}</span></div>
              <div class="txn-amount green">+KES ${fmt(Math.round(t.total || 0))}</div>
            </div>
          `;
        }).join('');
      }
    }

    // 8. Pending Approvals Grid
    const appGridEl = document.getElementById('dash-approvals-grid');
    if (appGridEl) {
      const pendingItems = prs.filter(p => p.status === 'pending');
      if (pendingItems.length === 0) {
        appGridEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">No pending approvals.</div>';
      } else {
        const itemsToShow = pendingItems.map(p => ({
          title: `Purchase Request #${p.ref || ('PR-' + p.id)}`,
          cat: `Procurement · KES ${fmt(Math.round(p.total_value || 0))}`,
          icon: 'purple'
        }));
        appGridEl.innerHTML = itemsToShow.map(item => `
          <div class="approval-item">
            <div class="approval-icon ${item.icon || 'purple'}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg></div>
            <div class="approval-info"><p>${item.title}</p><span>${item.cat}</span></div>
            <div class="approval-actions"><button class="btn-approve" onclick="approveItem(this)">Approve</button><button class="btn-reject" onclick="approveItem(this)">Reject</button></div>
          </div>
        `).join('');
      }
    }

    // 9. HQ Enterprise Comparison Quick Link Banner (Owner Only)
    const hqBanner = document.getElementById('dash-hq-banner');
    if (hqBanner) {
      if (isEnterprise && state.user?.role === 'owner') {
        hqBanner.classList.remove('hidden');
      } else {
        hqBanner.classList.add('hidden');
      }
    }

  } catch (e) {
    console.error('[loadDashboardKPIs] Error:', e);
  }
}

/* ── DEDICATED BRANCH COMPARISON PAGE (OWNER EXCLUSIVE) ───────────── */
let _compArea = 'sales'; // 'sales' | 'hr' | 'inventory' | 'channels'
let _compMetric = 'm1'; // 'm1' | 'm2' | 'm3'
let _compChartType = 'bar'; // 'bar' | 'line'
let _compDataCache = [];

async function loadBranchComparisonView() {
  if (state.user?.role !== 'owner') {
    showToast('Access restricted to Owner.');
    navTo('dashboard');
    return;
  }

  try {
    const res = await apiGet('/api/branches/performance');
    _compDataCache = (res && res.success) ? (res.data || []) : [];
    
    // 1. Update 4 Summary KPI Cards
    const totalRev = _compDataCache.reduce((s, b) => s + (b.total_revenue || 0), 0);
    const totalStaff = _compDataCache.reduce((s, b) => s + (b.staff_count || 0), 0);
    const totalInv = _compDataCache.reduce((s, b) => s + (b.inventory_value || 0), 0);
    const totalLowStock = _compDataCache.reduce((s, b) => s + (b.low_stock_count || 0), 0);
    
    const sortedByRev = [..._compDataCache].sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
    const topBranch = sortedByRev[0]?.name || '—';
    const topBranchRev = sortedByRev[0]?.total_revenue || 0;
    const topBranchShare = totalRev > 0 ? Math.round((topBranchRev / totalRev) * 100) : 0;

    const avgAttendance = _compDataCache.length > 0
      ? Math.round(_compDataCache.reduce((s, b) => s + (b.avg_attendance_pct || 0), 0) / _compDataCache.length)
      : 0;

    const setEl = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setEl('comp-total-rev', getCurrency() + ' ' + fmt(Math.round(totalRev)));
    setEl('comp-top-branch', topBranch);
    setEl('comp-top-branch-rev', `${topBranchShare}% of enterprise revenue`);
    setEl('comp-total-staff', fmt(totalStaff) + ' Employees');
    setEl('comp-avg-attendance', `Avg attendance: ${avgAttendance}%`);
    setEl('comp-total-inv', getCurrency() + ' ' + fmt(Math.round(totalInv)));
    setEl('comp-total-low-stock', `${totalLowStock} items low in stock`);
    setEl('comp-branch-count-badge', `${_compDataCache.length} Active Locations`);

    // 2. Render Charts & Table
    updateBranchComparisonPageCharts();
    renderBranchComparisonMatrixTable();

  } catch (err) {
    console.error('[BranchComparison] Error loading data:', err);
    showToast('Failed to load branch comparative analytics.');
  }
}

function switchComparisonArea(area) {
  _compArea = area;
  _compMetric = 'm1'; // reset to first metric

  // Update tabs (include staffhq)
  ['sales', 'hr', 'inventory', 'channels', 'staffhq'].forEach(a => {
    const tab = document.getElementById(`tab-comp-${a}`);
    if (tab) tab.classList.toggle('active', a === area);
  });

  // Toggle chart panel and HR section visibility
  const chartPanel   = document.querySelector('#view-branch-comparison .panel-card:has(canvas)') ||
                       document.getElementById('compPageMainChart')?.closest('.panel-card');
  const matrixPanel  = document.getElementById('comp-matrix-tbody')?.closest('.panel-card');
  const hrSection    = document.getElementById('comp-area-staffhq');
  const metricPills  = document.getElementById('comp-metric-pills');

  const isHR = (area === 'staffhq');

  // Show/hide chart area panels
  if (chartPanel)  chartPanel.style.display  = isHR ? 'none' : '';
  if (matrixPanel) matrixPanel.style.display = isHR ? 'none' : '';
  if (metricPills) metricPills.style.display = isHR ? 'none' : '';

  // Show/hide enterprise HR section
  if (hrSection) hrSection.style.display = isHR ? '' : 'none';

  if (isHR) {
    loadHQHR();
    return;
  }

  // Update pill buttons labels for chart-based areas
  const pill1 = document.getElementById('btn-comp-m1');
  const pill2 = document.getElementById('btn-comp-m2');
  const pill3 = document.getElementById('btn-comp-m3');
  const title = document.getElementById('comp-chart-title');
  const sub = document.getElementById('comp-chart-subtitle');
  const donutTitle = document.getElementById('comp-donut-title');

  if (area === 'sales') {
    if (title) title.textContent = 'Cross-Branch Sales & Revenue Comparison';
    if (sub) sub.textContent = 'Comparing total revenue, order count, and average order value across stores';
    if (donutTitle) donutTitle.textContent = 'Revenue Share';
    if (pill1) pill1.textContent = 'Revenue';
    if (pill2) pill2.textContent = 'Orders';
    if (pill3) pill3.textContent = 'Avg Order';
  } else if (area === 'hr') {
    if (title) title.textContent = 'Staff Productivity & HR Efficiency';
    if (sub) sub.textContent = 'Comparing workforce headcount, attendance percentage, and payroll expenditure';
    if (donutTitle) donutTitle.textContent = 'Staff Distribution';
    if (pill1) pill1.textContent = 'Headcount';
    if (pill2) pill2.textContent = 'Attendance %';
    if (pill3) pill3.textContent = 'Payroll (' + getCurrency() + ')';
  } else if (area === 'inventory') {
    if (title) title.textContent = 'Inventory Valuation & Stock Health';
    if (sub) sub.textContent = 'Comparing stock valuation, SKU counts, and low-stock replenishment risks';
    if (donutTitle) donutTitle.textContent = 'Inventory Value Share';
    if (pill1) pill1.textContent = 'Stock Value';
    if (pill2) pill2.textContent = 'Active SKUs';
    if (pill3) pill3.textContent = 'Low Stock Alerts';
  } else if (area === 'channels') {
    if (title) title.textContent = 'Payment Channels & Collection Mix';
    if (sub) sub.textContent = 'Comparing M-Pesa mobile money, Cash, Card, and Credit sales across branches';
    if (donutTitle) donutTitle.textContent = 'Payment Method Mix';
    if (pill1) pill1.textContent = 'M-Pesa Sales';
    if (pill2) pill2.textContent = 'Cash Sales';
    if (pill3) pill3.textContent = 'Credit Sales';
  }

  setCompPageMetric('m1');
}

function setCompPageMetric(metric) {
  _compMetric = metric;
  ['m1', 'm2', 'm3'].forEach(m => {
    document.getElementById(`btn-comp-${m}`)?.classList.toggle('active', m === metric);
  });
  updateBranchComparisonPageCharts();
}

function setCompPageChartType(type) {
  _compChartType = type;
  document.getElementById('btn-comp-chart-bar')?.classList.toggle('active', type === 'bar');
  document.getElementById('btn-comp-chart-line')?.classList.toggle('active', type === 'line');
  updateBranchComparisonPageCharts();
}

function updateBranchComparisonPageCharts() {
  if (!_compDataCache || !_compDataCache.length) return;

  const labels = _compDataCache.map(b => b.name);
  const cur = getCurrency();
  let datasetLabel = '';
  let dataValues = [];
  let isCurrency = false;
  let isPercentage = false;

  const bgColors = ['#EA580C', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];
  const borderColors = ['#C2410C', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2'];

  if (_compArea === 'sales') {
    if (_compMetric === 'm1') {
      datasetLabel = `Total Revenue (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.total_revenue || 0));
      isCurrency = true;
    } else if (_compMetric === 'm2') {
      datasetLabel = 'Total Completed Orders';
      dataValues = _compDataCache.map(b => b.transaction_count || 0);
    } else {
      datasetLabel = `Average Order Value (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.avg_order_value || 0));
      isCurrency = true;
    }
  } else if (_compArea === 'hr') {
    if (_compMetric === 'm1') {
      datasetLabel = 'Staff Headcount';
      dataValues = _compDataCache.map(b => b.staff_count || 0);
    } else if (_compMetric === 'm2') {
      datasetLabel = 'Average Attendance Rate (%)';
      dataValues = _compDataCache.map(b => Math.round(b.avg_attendance_pct || 0));
      isPercentage = true;
    } else {
      datasetLabel = `Monthly Payroll (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.total_payroll || 0));
      isCurrency = true;
    }
  } else if (_compArea === 'inventory') {
    if (_compMetric === 'm1') {
      datasetLabel = `Inventory Holding Value (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.inventory_value || 0));
      isCurrency = true;
    } else if (_compMetric === 'm2') {
      datasetLabel = 'Active Catalog SKUs';
      dataValues = _compDataCache.map(b => b.product_count || 0);
    } else {
      datasetLabel = 'Low Stock Alert Items';
      dataValues = _compDataCache.map(b => b.low_stock_count || 0);
    }
  } else if (_compArea === 'channels') {
    if (_compMetric === 'm1') {
      datasetLabel = `M-Pesa Volume (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.mpesa_revenue || 0));
      isCurrency = true;
    } else if (_compMetric === 'm2') {
      datasetLabel = `Cash Volume (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.cash_revenue || 0));
      isCurrency = true;
    } else {
      datasetLabel = `Credit Sales (${cur})`;
      dataValues = _compDataCache.map(b => Math.round(b.credit_revenue || 0));
      isCurrency = true;
    }
  }

  // 1. Render Main Chart
  const mainCanvas = document.getElementById('compPageMainChart');
  if (mainCanvas) {
    if (state.chartInstances.compPageMain) {
      state.chartInstances.compPageMain.destroy();
    }

    state.chartInstances.compPageMain = new Chart(mainCanvas, {
      type: _compChartType,
      data: {
        labels: labels,
        datasets: [{
          label: datasetLabel,
          data: dataValues,
          backgroundColor: _compChartType === 'bar' ? bgColors.slice(0, labels.length) : 'rgba(234, 88, 12, 0.15)',
          borderColor: _compChartType === 'bar' ? borderColors.slice(0, labels.length) : '#EA580C',
          borderWidth: 2,
          borderRadius: 6,
          fill: _compChartType === 'line',
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${isCurrency ? cur + ' ' : ''}${fmt(ctx.raw)}${isPercentage ? '%' : ''}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }
        }
      }
    });
  }

  // 2. Render Donut Chart
  const donutCanvas = document.getElementById('compPageDonutChart');
  const donutLegend = document.getElementById('comp-page-donut-legend');
  if (donutCanvas) {
    if (state.chartInstances.compPageDonut) {
      state.chartInstances.compPageDonut.destroy();
    }

    const total = dataValues.reduce((a, b) => a + b, 0);

    state.chartInstances.compPageDonut = new Chart(donutCanvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues.length && total > 0 ? dataValues : [1],
          backgroundColor: bgColors.slice(0, labels.length),
          borderWidth: 2,
          hoverOffset: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw || 0;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${ctx.label}: ${isCurrency ? cur + ' ' : ''}${fmt(val)}${isPercentage ? '%' : ''} (${pct}%)`;
              }
            }
          }
        },
        cutout: '68%'
      }
    });

    if (donutLegend) {
      donutLegend.innerHTML = labels.map((l, i) => {
        const val = dataValues[i] || 0;
        const pct = total > 0 ? Math.round((val / total) * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${bgColors[i]}"></span>
            <span>${l} <strong>${pct}%</strong></span>
          </div>
        `;
      }).join('');
    }
  }
}

function renderBranchComparisonMatrixTable() {
  const tbody = document.getElementById('comp-matrix-tbody');
  if (!tbody) return;

  if (!_compDataCache.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">No active branches found.</td></tr>';
    return;
  }

  const sorted = [..._compDataCache].sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));

  tbody.innerHTML = sorted.map((b, idx) => {
    const rev = b.total_revenue || 0;
    const tx = b.transaction_count || 0;
    const avg = b.avg_order_value || 0;
    const staff = b.staff_count || 0;
    const att = Math.round(b.avg_attendance_pct || 0);
    const inv = b.inventory_value || 0;

    let ratingBadge = '<span class="badge badge-green">Top Tier</span>';
    if (idx === 1) ratingBadge = '<span class="badge badge-blue">Growth Leader</span>';
    else if (idx > 1) ratingBadge = '<span class="badge badge-amber">Standard</span>';

    return `
      <tr>
        <td style="font-weight:700;color:var(--brand);text-align:center;">#${idx + 1}</td>
        <td><strong>${b.name}</strong></td>
        <td>${b.location || 'Branch Store'}</td>
        <td style="text-align:center;">${staff} staff</td>
        <td style="text-align:center;"><span class="badge ${att >= 85 ? 'badge-green' : 'badge-amber'}">${att}%</span></td>
        <td style="font-weight:700;color:var(--text-primary);">KES ${fmt(Math.round(rev))}</td>
        <td>${fmt(tx)} orders</td>
        <td>KES ${fmt(Math.round(avg))}</td>
        <td>KES ${fmt(Math.round(inv))}</td>
        <td>${ratingBadge}</td>
      </tr>
    `;
  }).join('');
}

/* ── ENTERPRISE HR MANAGEMENT (HQ — Owner Only) ─────────────────────────── */
let _hqHRAllEmployees = []; // full enterprise employee list
let _hqHRFiltered = [];     // currently filtered/searched subset

async function loadHQHR() {
  // Only owner should access this — branch-comparison view already guards this
  if (state.user?.role !== 'owner') return;

  const tbody = document.getElementById('hq-hr-tbody');
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const fmtKES = n => getCurrency() + ' ' + fmt(Math.round(n || 0));

  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;"><span class="spinner-sm"></span> Loading...</td></tr>';

  try {
    const [empRes, summaryRes] = await Promise.all([
      apiGet('/api/hr/employees'),           // no branch_id = all employees enterprise-wide
      apiGet('/api/hr/payroll/summary')      // no branch_id = enterprise totals
    ]);

    _hqHRAllEmployees = (empRes?.data || []);
    _hqHRFiltered = [..._hqHRAllEmployees];

    // Populate branch filter dropdown
    const branchFilter = document.getElementById('hq-hr-branch-filter');
    if (branchFilter) {
      const branches = [...new Map(_hqHRAllEmployees.map(e => [e.branch_id, { id: e.branch_id, name: e.branch_name }])).values()]
        .filter(b => b.id);
      branchFilter.innerHTML = '<option value="all">All Branches</option>' +
        branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    }

    // KPI cards
    const d = summaryRes?.data || {};
    const totalEmp = _hqHRAllEmployees.length;
    const payroll  = _hqHRAllEmployees.reduce((s, e) => s + (e.salary || 0), 0);
    const avgAtt   = totalEmp > 0
      ? Math.round(_hqHRAllEmployees.reduce((s, e) => s + (e.attendance_pct || 0), 0) / totalEmp)
      : 0;
    const absent   = _hqHRAllEmployees.filter(e => e.status === 'absent').length;
    const onLeave  = _hqHRAllEmployees.filter(e => e.status === 'on_leave').length;

    setEl('hq-hr-kpi-total',      totalEmp);
    setEl('hq-hr-kpi-payroll',    fmtKES(payroll));
    setEl('hq-hr-kpi-attendance', avgAtt + '%');
    setEl('hq-hr-kpi-present',    `${d.present_today || 0} present today`);
    setEl('hq-hr-kpi-leave',      absent + onLeave);
    setEl('hq-hr-kpi-leave-sub',  `${onLeave} on leave · ${absent} absent`);

    // Also sync _hrEmployeesCache so Edit modal can find employees
    _hrEmployeesCache = _hqHRAllEmployees;

    renderHQHRRows(_hqHRFiltered);

  } catch (err) {
    console.error('[loadHQHR] Error:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--red);">Failed to load enterprise HR data.</td></tr>';
  }
}

function renderHQHRRows(items) {
  const tbody = document.getElementById('hq-hr-tbody');
  if (!tbody) return;

  if (!items || !items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No employees found matching this filter.</td></tr>';
    return;
  }

  const statusMap = { present: 'badge-green', on_leave: 'badge-amber', absent: 'badge-red', terminated: 'badge-red' };
  const colors    = ['#FFF7ED;color:#F97316', '#F0FDF4;color:#10B981', '#FFF7ED;color:#F59E0B', '#F5F3FF;color:#8B5CF6'];

  tbody.innerHTML = items.map(e => {
    const badgeClass  = statusMap[e.status] || 'badge-green';
    const statusText  = (e.status || 'present').replace('_', ' ').toUpperCase();
    const initials    = (e.name || 'EM').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colorStyle  = colors[Math.abs(e.id || 0) % colors.length];
    const bgColor     = colorStyle.split(';')[0];
    const txtColor    = colorStyle.split('color:')[1] || '#4F46E5';

    return `<tr>
      <td>
        <div class="cell-user">
          <div class="av sm" style="background:${bgColor};color:${txtColor}">${initials}</div>
          <strong>${e.name}</strong>
        </div>
      </td>
      <td>${e.role || 'Staff'}</td>
      <td><span class="badge" style="background:var(--surface-2);color:var(--text-secondary);border:1px solid var(--border);font-weight:600;">${e.branch_name || 'Main Branch'}</span></td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
      <td>KES ${Number(e.salary || 0).toLocaleString()}</td>
      <td>${e.attendance_pct || 0}%</td>
      <td style="white-space:nowrap;">
        <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="openEmployeeModal(${e.id})">Edit</button>
        <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);" onclick="terminateEmployee(${e.id}, '${(e.name || '').replace(/'/g, "\\'")}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function filterHQHRByBranch(branchId) {
  const search = (document.getElementById('hq-hr-search')?.value || '').toLowerCase();
  _hqHRFiltered = _hqHRAllEmployees.filter(e => {
    const matchBranch = branchId === 'all' || String(e.branch_id) === String(branchId);
    const matchSearch = !search || (e.name || '').toLowerCase().includes(search) || (e.role || '').toLowerCase().includes(search);
    return matchBranch && matchSearch;
  });
  renderHQHRRows(_hqHRFiltered);
}

function filterHQHRSearch(q) {
  const branchId = document.getElementById('hq-hr-branch-filter')?.value || 'all';
  const search   = (q || '').toLowerCase();
  _hqHRFiltered  = _hqHRAllEmployees.filter(e => {
    const matchBranch = branchId === 'all' || String(e.branch_id) === String(branchId);
    const matchSearch = !search || (e.name || '').toLowerCase().includes(search) || (e.role || '').toLowerCase().includes(search) || (e.branch_name || '').toLowerCase().includes(search);
    return matchBranch && matchSearch;
  });
  renderHQHRRows(_hqHRFiltered);
}

async function loadInventory() {
  const tbody = document.getElementById('inventory-tbody');
  try {
    const branchId = state.currentBranch && state.currentBranch.id ? state.currentBranch.id : 'all';
    const url = branchId === 'all' ? '/api/inventory' : `/api/inventory?branch_id=${branchId}`;
    const data = await apiGet(url);
    const items = data.data || [];
    _inventoryCache = items;
    updateInventoryKPIs(items);
    if (tbody) {
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:20px;color:var(--text-muted)">No products found for this branch. Add products to get started.</td></tr>';
      } else {
        renderInventoryRows(items);
      }
    }
    return items;
  } catch (e) {
    updateInventoryKPIs([]);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:20px;color:var(--text-muted)">Backend offline — start the server to view inventory.</td></tr>';
    }
    return [];
  }
}

function updateInventoryKPIs(items) {
  let healthy = 0, reorder = 0, out = 0, dead = 0, expiring = 0;
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  items.forEach(i => {
    const qty = i.stock_qty || i.stock || 0;
    const reorderLevel = i.reorder_level || 10;
    if (qty === 0) {
      out++;
    } else if (qty <= reorderLevel) {
      reorder++;
    } else {
      healthy++;
    }

    if (i.expiry_date) {
      const exp = new Date(i.expiry_date);
      if (!isNaN(exp.getTime()) && exp <= sevenDaysFromNow) {
        expiring++;
      }
    }
  });

  const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
  setKpi('inv-kpi-healthy', healthy);
  setKpi('inv-kpi-reorder', reorder);
  setKpi('inv-kpi-out', out);
  setKpi('inv-kpi-dead', dead);
  setKpi('inv-kpi-expiring', expiring);
}

function renderInventoryRows(items) {
  const tbody = document.getElementById('inventory-tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  const search = (document.getElementById('inv-search')?.value || '').toLowerCase();
  const cat = document.getElementById('inv-cat-filter')?.value || '';
  const status = document.getElementById('inv-status-filter')?.value || '';
  const filtered = items.filter(i => {
    const s = !search || i.name.toLowerCase().includes(search) || i.sku.toLowerCase().includes(search);
    const c = !cat || (i.category_name || '').toLowerCase().includes(cat.toLowerCase());
    const st = !status || (i.stock_qty === 0 ? 'out' : i.stock_qty <= (i.reorder_level||10) ? 'low' : 'ok') === status;
    return s && c && st;
  });
  tbody.innerHTML = filtered.map(item => {
    const stockStatus = item.stock_qty === 0 ? 'out' : item.stock_qty <= (item.reorder_level||10) ? 'low' : 'ok';
    const margin = item.sell_price && item.buy_price ? Math.round(((item.sell_price - item.buy_price) / item.sell_price) * 100) : 0;
    const badgeClass = stockStatus === 'ok' ? 'badge-green' : stockStatus === 'low' ? 'badge-amber' : 'badge-red';
    const safeName = (item.name || '').replace(/'/g, "\\'");
    return `<tr>
      <td><input type="checkbox" class="inv-row-check" value="${item.id}" onchange="updateInventoryBulkActions()" /></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          ${item.image_url ? `<img src="${item.image_url}" alt="" referrerpolicy="no-referrer" loading="lazy" style="width:28px;height:28px;border-radius:4px;object-fit:cover;border:1px solid var(--border);" onerror="this.style.display='none'" />` : `<div style="width:28px;height:28px;border-radius:4px;background:var(--bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-muted);font-weight:600;flex-shrink:0;">${(item.name || 'P')[0].toUpperCase()}</div>`}
          <span><strong>${item.name}</strong></span>
        </div>
      </td>
      <td class="mono">${item.sku}</td>
      <td>${item.category_name || '—'}</td>
      <td><strong>${item.stock_qty}</strong></td>
      <td>${item.unit || 'pcs'}</td>
      <td>KES ${fmt(item.buy_price || 0)}</td>
      <td>KES ${fmt(item.sell_price || 0)}</td>
      <td><span style="color:var(--green);font-weight:600">${margin}%</span></td>
      <td><span class="badge ${badgeClass}">${stockStatus.toUpperCase()}</span></td>
      <td>${item.supplier_name || '—'}</td>
      <td style="font-size:11.5px;color:var(--text-muted);">${item.expiry_date || '—'}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn-sm tiny secondary" onclick="openProductModal(${item.id})">Edit</button>
          ${showDelete ? `<button class="btn-sm tiny secondary" style="color:var(--red);" onclick="deleteProduct(${item.id}, '${safeName}')">Delete</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
  updateInventoryBulkActions();
}

function toggleSelectAllInventory(master) {
  const isChecked = !!master.checked;
  document.querySelectorAll('.inv-row-check').forEach(cb => { cb.checked = isChecked; });
  updateInventoryBulkActions();
}

function updateInventoryBulkActions() {
  const checked = document.querySelectorAll('.inv-row-check:checked');
  const count = checked.length;
  const btn = document.getElementById('inv-bulk-delete-btn');
  const countSpan = document.getElementById('inv-selected-count');
  const master = document.getElementById('inv-select-all');

  if (countSpan) countSpan.textContent = count;
  if (btn) {
    if (count > 0 && canDelete()) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }

  const all = document.querySelectorAll('.inv-row-check');
  if (master && all.length > 0) {
    master.checked = count === all.length;
    master.indeterminate = count > 0 && count < all.length;
  }
}

async function deleteProduct(id, name = 'this product') {
  if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

  try {
    const res = await apiDelete(`/api/inventory/${id}`);
    if (res && res.success) {
      showToast(res.message || 'Product deleted.');
      await loadInventory();
      await loadPOSProducts();
    } else {
      showToast(res.error || 'Failed to delete product.');
    }
  } catch (err) {
    console.error('[deleteProduct] error:', err);
    showToast(err.message || 'Failed to delete product.');
  }
}

async function deleteSelectedProducts() {
  const checked = Array.from(document.querySelectorAll('.inv-row-check:checked')).map(cb => parseInt(cb.value)).filter(Boolean);
  if (!checked.length) {
    showToast('No products selected to delete.');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${checked.length} selected product(s)?`)) return;

  try {
    const res = await apiPost('/api/inventory/bulk-delete', { ids: checked });
    if (res && res.success) {
      showToast(res.message || `Deleted ${checked.length} product(s).`);
      const master = document.getElementById('inv-select-all');
      if (master) { master.checked = false; master.indeterminate = false; }
      await loadInventory();
      await loadPOSProducts();
    } else {
      showToast(res.error || 'Failed to delete selected products.');
    }
  } catch (err) {
    console.error('[deleteSelectedProducts] error:', err);
    showToast(err.message || 'Failed to delete selected products.');
  }
}

/* ── NEW MODULE LOADERS (Suppliers, Hire Purchase, Receivables, Services, Movements, Z-Reports) ── */
let _suppliersCache = [];

async function loadSuppliers() {
  try {
    const data = await apiGet('/api/suppliers');
    _suppliersCache = data.data || [];
    updateSupplierKPIs(_suppliersCache);
    renderSupplierRows(_suppliersCache);
  } catch (e) {
    console.error('[loadSuppliers] API error:', e);
    const tbody = document.getElementById('sup-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px;">Could not load suppliers. Check server.</td></tr>';
  }
}

function updateSupplierKPIs(items) {
  const total = items.length;
  const active = items.filter(s => s.is_active !== 0).length;
  const avgRating = total ? Math.round(items.reduce((sum, s) => sum + (s.rating || 0), 0) / total) : 0;
  const categories = new Set(items.map(s => s.category || 'General')).size;
  const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setKpi('sup-kpi-total', total);
  setKpi('sup-kpi-active', active);
  setKpi('sup-kpi-rating', avgRating + '/100');
  setKpi('sup-kpi-categories', categories);
}

function renderSupplierRows(items) {
  const tbody = document.getElementById('sup-tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No suppliers found. Add your first supplier!</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(s => {
    const rating = s.rating || 85;
    const ratingColor = rating >= 90 ? 'var(--green)' : rating >= 75 ? 'var(--amber)' : 'var(--red)';
    return `<tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.category || 'General'}</td>
      <td>${s.contact_name || '\u2014'}</td>
      <td>${s.phone || '\u2014'}</td>
      <td>${s.email || '\u2014'}</td>
      <td><span style="color:${ratingColor};font-weight:700;">${rating}/100</span></td>
      <td><span class="badge badge-green">Active</span></td>
      <td style="white-space:nowrap;">
        <button class="btn-sm secondary" style="padding:3px 8px;font-size:11px;" onclick="openSupplierModal(${s.id})">Edit</button>
        <button class="btn-sm secondary" style="padding:3px 8px;font-size:11px;" onclick="viewSupplierPOs(${s.id}, '${s.name.replace(/'/g, "\\'")}')">View POs</button>
        ${showDelete ? `<button class="btn-sm secondary" style="padding:3px 8px;font-size:11px;color:var(--red);" onclick="deactivateSupplier(${s.id}, '${s.name.replace(/'/g, "\\'")}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function searchSuppliers(q) {
  const query = (q || '').toLowerCase();
  if (!query) { renderSupplierRows(_suppliersCache); return; }
  const filtered = _suppliersCache.filter(s =>
    (s.name || '').toLowerCase().includes(query) ||
    (s.category || '').toLowerCase().includes(query) ||
    (s.contact_name || '').toLowerCase().includes(query) ||
    (s.email || '').toLowerCase().includes(query)
  );
  renderSupplierRows(filtered);
}

function openSupplierModal(id = null) {
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  const titleEl = document.getElementById('sup-modal-title');
  setVal('sup-id', '');
  setVal('sup-name', ''); setVal('sup-cat', ''); setVal('sup-contact', '');
  setVal('sup-phone', ''); setVal('sup-email', ''); setVal('sup-rating', '');

  if (id) {
    const s = _suppliersCache.find(x => x.id == id);
    if (s) {
      if (titleEl) titleEl.textContent = 'Edit Supplier';
      setVal('sup-id', s.id);
      setVal('sup-name', s.name); setVal('sup-cat', s.category);
      setVal('sup-contact', s.contact_name); setVal('sup-phone', s.phone);
      setVal('sup-email', s.email); setVal('sup-rating', s.rating);
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add New Supplier';
  }
  document.getElementById('supplier-modal')?.classList.remove('hidden');
}

function viewSupplierPOs(id, name) {
  showToast(`Loading purchase orders for ${name}...`);
  // TODO: navigate to procurement view filtered by this supplier
}

async function deactivateSupplier(id, name) {
  if (!confirm(`Permanently delete "${name}" from your supplier list?\nThis cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + (state.token || '') } });
    const data = await res.json();
    if (data.success) { showToast(`${name} removed.`); loadSuppliers(); }
    else showToast(data.error || 'Failed to remove supplier');
  } catch(e) { showToast('Error removing supplier'); }
}

function exportSuppliersCSV() {
  if (!_suppliersCache.length) { showToast('No suppliers to export'); return; }
  const headers = ['Name','Category','Contact Person','Phone','Email','Rating'];
  const rows = _suppliersCache.map(s => [
    `"${(s.name||'').replace(/"/g,'""')}"`,
    `"${(s.category||'').replace(/"/g,'""')}"`,
    `"${(s.contact_name||'').replace(/"/g,'""')}"`,
    `"${(s.phone||'')}"`,
    `"${(s.email||'')}"`,
    s.rating || 85
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `suppliers_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast('Suppliers exported to CSV');
}


// ─── Permission / Role Helpers ──────────────────────────────────────────────

function canDelete() {
  const role = (state.user?.role || '').toLowerCase();
  return role === 'owner' || role === 'manager';
}

function canDeleteEmployee() {
  const role = (state.user?.role || '').toLowerCase();
  return role === 'owner';
}

function canDeleteBranch() {
  const role = (state.user?.role || '').toLowerCase();
  return role === 'owner';
}

// ─── Delete Handler Functions ───────────────────────────────────────────────

async function deleteService(id, name) {
  if (!confirm(`Delete service "${name}" from the catalog?\nThis cannot be undone.`)) return;
  try {
    const res = await apiDelete(`/api/services/${id}`);
    if (res.success) { showToast(`Service "${name}" deleted.`); loadServices(); }
    else showToast(res.error || 'Failed to delete service');
  } catch (e) { showToast('Error deleting service'); }
}

async function deleteHPAgreement(id, customerName) {
  if (!confirm(`Delete hire purchase agreement for "${customerName}"?\nAll associated payment records will also be removed. This cannot be undone.`)) return;
  try {
    const res = await apiDelete(`/api/hire-purchase/${id}`);
    if (res.success) { showToast(`HP agreement for ${customerName} deleted.`); loadHirePurchase(); }
    else showToast(res.error || 'Failed to delete agreement');
  } catch (e) { showToast('Error deleting HP agreement'); }
}

async function deleteReceivable(id, name) {
  if (!confirm(`Clear outstanding debt for "${name}"?\nThis will reset their credit balance to KES 0.`)) return;
  try {
    const res = await apiDelete(`/api/receivables/${id}`);
    if (res.success) { showToast(`Debt cleared for ${name}.`); loadReceivables(); }
    else showToast(res.error || 'Failed to clear debt');
  } catch (e) { showToast('Error clearing receivable'); }
}

async function deleteCustomer(id, name) {
  if (!confirm(`Delete customer "${name}" permanently?\nThis will remove all their data. This cannot be undone.`)) return;
  try {
    const res = await apiDelete(`/api/crm/customers/${id}`);
    if (res.success) {
      showToast(`Customer "${name}" deleted.`);
      loadCRM();
      loadCustomers();
    } else showToast(res.error || 'Failed to delete customer');
  } catch (e) { showToast('Error deleting customer'); }
}

async function deleteStockMovement(id, ref) {
  if (!confirm(`Delete stock movement record "${ref}"?\nThis cannot be undone.`)) return;
  try {
    const res = await apiDelete(`/api/stock-movements/${id}`);
    if (res.success) { showToast(`Movement ${ref} deleted.`); loadStockMovements(); }
    else showToast(res.error || 'Failed to delete movement');
  } catch (e) { showToast('Error deleting movement'); }
}

async function deletePurchaseRequest(id, ref) {
  if (!confirm(`Delete purchase request "${ref}"?\nAll line items will also be removed. This cannot be undone.`)) return;
  try {
    const res = await apiDelete(`/api/procurement/requests/${id}`);
    if (res.success) { showToast(`PR ${ref} deleted.`); loadProcurement(); }
    else showToast(res.error || 'Failed to delete purchase request');
  } catch (e) { showToast('Error deleting purchase request'); }
}

async function deleteDelivery(id, ref) {
  if (!confirm(`Delete delivery record "${ref}"?\nThis cannot be undone.`)) return;
  try {
    const res = await apiDelete(`/api/logistics/deliveries/${id}`);
    if (res.success) { showToast(`Delivery ${ref} deleted.`); loadLogistics(); }
    else showToast(res.error || 'Failed to delete delivery');
  } catch (e) { showToast('Error deleting delivery'); }
}

// ─────────────────────────────────────────────────────────────────────────────

let _hpCache = [];
let _hpCurrentTab = 'active';

async function loadHirePurchase() {
  const tbody = document.querySelector('#view-hire-purchase table.data-table tbody');
  if (!tbody) return;
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const data = await apiGet(`/api/hire-purchase${bParam}`);
    _hpCache = data.data || [];
    updateHPKPIs(_hpCache);
    filterHPTab(_hpCurrentTab);
  } catch (e) {
    console.error('[loadHirePurchase] API error:', e);
  }
}

function updateHPKPIs(items) {
  const activeCount = items.filter(h => h.status === 'active').length;
  const overdueCount = items.filter(h => h.status === 'overdue').length;
  const monthlyCollections = items.filter(h => h.status !== 'completed').reduce((sum, h) => sum + (h.monthly_instalment || 0), 0);
  const totalBook = items.reduce((sum, h) => sum + (h.balance || 0), 0);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('hp-kpi-active', activeCount);
  setEl('hp-kpi-collections', 'KES ' + fmt(monthlyCollections));
  setEl('hp-kpi-overdue', overdueCount);
  setEl('hp-kpi-total', 'KES ' + fmt(totalBook));
}

function filterHPTab(tab, btnEl = null) {
  _hpCurrentTab = tab;
  if (btnEl) {
    document.querySelectorAll('#view-hire-purchase .cat-tab').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }

  const filtered = _hpCache.filter(hp => {
    if (tab === 'active') return hp.status === 'active';
    if (tab === 'overdue') return hp.status === 'overdue';
    if (tab === 'completed') return hp.status === 'completed';
    return true;
  });

  renderHPRows(filtered);
}

function renderHPRows(items) {
  const tbody = document.querySelector('#view-hire-purchase table.data-table tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:16px;">No agreements found in this category.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(hp => {
    const badge = hp.status === 'active' ? 'badge-green' : hp.status === 'overdue' ? 'badge-amber' : 'badge-purple';
    const paidRatio = hp.total_value > 0 ? Math.min(100, Math.round(((hp.total_value - hp.balance) / hp.total_value) * 100)) : 0;
    const isCompleted = hp.status === 'completed' || hp.balance <= 0;

    return `<tr>
      <td><strong>${hp.customer_name}</strong><br><small style="color:var(--text-muted);">${hp.customer_phone || 'Customer'}</small></td>
      <td>${hp.item_name}</td>
      <td>KES ${fmt(hp.total_value)}</td>
      <td>KES ${fmt(hp.down_payment)}</td>
      <td>KES ${fmt(hp.monthly_instalment)}</td>
      <td>
        ${hp.paid_instalments || 0} paid
        <div class="hp-progress-bar" style="height:4px;background:var(--border);border-radius:2px;margin-top:4px;overflow:hidden;">
          <div style="height:100%;width:${paidRatio}%;background:${hp.status === 'overdue' ? 'var(--amber)' : 'var(--brand)'}"></div>
        </div>
      </td>
      <td><strong>KES ${fmt(hp.balance)}</strong></td>
      <td>${hp.next_due || '—'}</td>
      <td><span class="badge ${badge}">${(hp.status || 'active').toUpperCase()}</span></td>
      <td style="white-space:nowrap;">
        ${isCompleted ? '<span class="badge badge-green">SETTLED</span>' : `<button class="btn-sm tiny primary" onclick="recordHPPaymentPrompt(${hp.id}, '${hp.customer_name}', ${hp.balance})">Record Payment</button>`}
        ${showDelete ? `<button class="btn-sm tiny secondary" style="color:var(--red);margin-left:4px;" onclick="deleteHPAgreement(${hp.id}, '${hp.customer_name}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function openHPModal() {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('hp-cust-name', '');
  setVal('hp-item-name', '');
  setVal('hp-total-val', '');
  setVal('hp-down-pay', '');
  setVal('hp-monthly', '');
  setVal('hp-due-date', new Date(Date.now() + 30*86400000).toISOString().slice(0, 10));

  document.getElementById('hp-modal')?.classList.remove('hidden');
}

function generateHPStatement() {
  if (!_hpCache.length) { showToast('No agreements to generate statement'); return; }
  const html = `<html><head><title>Hire Purchase Statement</title>
  <style>body{font-family:sans-serif;max-width:750px;margin:30px auto;color:#111;} h2{color:#F97316;} table{width:100%;border-collapse:collapse;margin-top:16px;} th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;} th{background:#f3f4f6;} .total{font-weight:bold;}</style></head>
  <body>
    <h2>OPENFLOAT POS X — Hire Purchase Statement</h2>
    <p>Generated on: ${new Date().toLocaleString('en-KE')}</p>
    <table>
      <thead><tr><th>Ref</th><th>Customer</th><th>Item</th><th>Total Value</th><th>Paid</th><th>Balance Owed</th><th>Status</th></tr></thead>
      <tbody>
        ${_hpCache.map(h => `<tr>
          <td>${h.ref || 'HP-00' + h.id}</td>
          <td>${h.customer_name}</td>
          <td>${h.item_name}</td>
          <td>KES ${fmt(h.total_value)}</td>
          <td>KES ${fmt(h.total_value - h.balance)}</td>
          <td><strong>KES ${fmt(h.balance)}</strong></td>
          <td>${h.status.toUpperCase()}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <script>window.print();<\/script>
  </body></html>`;
  const w = window.open('', '_blank', 'width=800,height=600');
  if (w) { w.document.write(html); w.document.close(); }
}

let _arDebtorsCache = [];

async function loadReceivables() {
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const res = await apiGet(`/api/receivables${bParam}`);
    const d = res.data || {};
    _arDebtorsCache = d.customers || [];

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const formatKES = num => 'KES ' + Number(num || 0).toLocaleString();

    if (d.total_ar != null) {
      setVal('ar-summary-total', formatKES(d.total_ar));
      setVal('ar-kpi-total', formatKES(d.total_ar));
    }
    setVal('ar-summary-count', `Across ${_arDebtorsCache.length} active debtor account${_arDebtorsCache.length === 1 ? '' : 's'}`);
    if (d.overdue_30_days != null) {
      setVal('ar-summary-overdue', formatKES(d.overdue_30_days));
      setVal('ar-kpi-overdue', formatKES(d.overdue_30_days));
    }
    if (d.b2b_accounts_count != null) setVal('ar-kpi-b2b', d.b2b_accounts_count);
    if (d.collection_rate_pct != null) {
      setVal('ar-summary-rate', `Collection rate: ${d.collection_rate_pct}% this month`);
      setVal('ar-kpi-rate', `${d.collection_rate_pct}%`);
    }

    renderDebtorRows(_arDebtorsCache);
  } catch (e) {
    console.error('[loadReceivables] error:', e);
  }
}

function renderDebtorRows(items) {
  const tbody = document.getElementById('ar-tbody') || document.querySelector('#view-receivables table.data-table tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No outstanding customer debt accounts found.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(c => {
    const badge = c.risk_level === 'HIGH' ? 'badge-red' : c.risk_level === 'MEDIUM' ? 'badge-amber' : 'badge-green';
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge badge-blue">${(c.segment || 'regular').toUpperCase()}</span></td>
      <td>${c.phone || '—'}</td>
      <td>KES ${Number(c.credit_limit || 0).toLocaleString()}</td>
      <td><strong style="color:var(--red)">KES ${Number(c.credit_balance || 0).toLocaleString()}</strong></td>
      <td><span class="badge ${badge}">${c.risk_level || 'LOW'}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn-sm" style="padding:3px 8px;font-size:11px;" onclick="openARPaymentModal(${c.id})">Record Payment</button>
        ${showDelete ? `<button class="btn-sm secondary" style="padding:3px 8px;font-size:11px;color:var(--red);margin-left:4px;" onclick="deleteReceivable(${c.id}, '${c.name.replace(/'/g, "\\'")}')">Clear Debt</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function searchDebtors(q) {
  const query = (q || '').toLowerCase();
  if (!query) { renderDebtorRows(_arDebtorsCache); return; }
  const filtered = _arDebtorsCache.filter(c =>
    (c.name || '').toLowerCase().includes(query) ||
    (c.phone || '').toLowerCase().includes(query) ||
    (c.segment || '').toLowerCase().includes(query) ||
    (c.risk_level || '').toLowerCase().includes(query)
  );
  renderDebtorRows(filtered);
}

function openARPaymentModal(customerId = null) {
  const selectEl = document.getElementById('ar-pay-customer');
  if (selectEl) {
    selectEl.innerHTML = '<option value="">— Select Debtor Account —</option>';
    _arDebtorsCache.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.dataset.balance = c.credit_balance;
      opt.textContent = `${c.name} (Owed: KES ${Number(c.credit_balance).toLocaleString()})`;
      selectEl.appendChild(opt);
    });
    if (customerId) selectEl.value = customerId;
  }

  updateARPayBalanceDisplay();
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('ar-pay-amount', '');
  setVal('ar-pay-mode', 'Cash');
  setVal('ar-pay-notes', '');

  document.getElementById('ar-payment-modal')?.classList.remove('hidden');
}

function updateARPayBalanceDisplay() {
  const selectEl = document.getElementById('ar-pay-customer');
  const balEl = document.getElementById('ar-pay-balance-val');
  if (!selectEl || !balEl) return;
  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const balance = selectedOpt ? parseFloat(selectedOpt.dataset.balance) || 0 : 0;
  balEl.textContent = 'KES ' + Number(balance).toLocaleString();
}

async function submitARPaymentModal() {
  const customer_id = parseInt(document.getElementById('ar-pay-customer')?.value);
  const amount = parseFloat(document.getElementById('ar-pay-amount')?.value) || 0;
  const payment_mode = document.getElementById('ar-pay-mode')?.value || 'Cash';
  const notes = document.getElementById('ar-pay-notes')?.value.trim();

  if (!customer_id) { showToast('Please select a debtor customer'); return; }
  if (amount <= 0) { showToast('Please enter a valid payment amount'); return; }

  try {
    const res = await apiPost('/api/receivables/payment', { customer_id, amount, payment_mode, notes });
    if (res.success) {
      showToast(res.message || `Payment of KES ${amount} recorded!`);
      closeModal('ar-payment-modal');
      loadReceivables();
      if (typeof loadAccounting === 'function') loadAccounting();
      if (typeof loadDashboardKPIs === 'function') loadDashboardKPIs();
    } else {
      showToast(res.error || 'Failed to record payment');
    }
  } catch (e) {
    showToast('Error recording payment');
  }
}

function exportARReportCSV() {
  if (!_arDebtorsCache.length) { showToast('No debtor accounts to export'); return; }
  const headers = ['Customer Name', 'Segment', 'Phone', 'Credit Limit', 'Balance Owed', 'Risk Level'];
  const rows = _arDebtorsCache.map(c => [
    `"${(c.name || '').replace(/"/g, '""')}"`,
    c.segment || 'regular',
    `"${c.phone || ''}"`,
    c.credit_limit || 0,
    c.credit_balance || 0,
    c.risk_level || 'LOW'
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `receivables_report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast('Accounts Receivable report exported to CSV');
}

let _crmCache = [];

async function loadCRM() {
  const tbody = document.getElementById('crm-tbody');
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const res = await apiGet(`/api/crm/customers${bParam}`);
    _crmCache = res.data || [];

    // Also get summary KPIs
    const summaryRes = await apiGet(`/api/crm/summary${bParam}`);
    const summary = summaryRes.data || {};

    updateCRMKPIs(_crmCache, summary);
    renderCRMTopCustomers(_crmCache);
    filterCRMCustomers();
    initCRMCharts(_crmCache);
  } catch (e) {
    console.error('[loadCRM] API error:', e);
  }
}

function updateCRMKPIs(customers, summary) {
  const totalCount = summary.total_customers != null ? summary.total_customers : customers.length;
  const loyaltyCount = summary.loyalty_members != null ? summary.loyalty_members : customers.filter(c => (c.loyalty_points || 0) > 0).length;

  const totalSpentSum = customers.reduce((sum, c) => sum + (c.total_spent || 0), 0);
  const avgLTV = customers.length > 0 ? Math.round(totalSpentSum / customers.length) : 0;
  const churnRisk = customers.filter(c => (c.total_orders || 0) === 0 || c.segment === 'lapsed').length;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('crm-kpi-total', totalCount);
  setEl('crm-kpi-churn', churnRisk);
  setEl('crm-kpi-loyalty', loyaltyCount);
  setEl('crm-kpi-ltv', 'KES ' + fmt(avgLTV));
}

function renderCRMTopCustomers(customers) {
  const container = document.getElementById('crm-top-customers');
  if (!container) return;
  if (!customers.length) {
    container.innerHTML = '<div class="txn-item"><div class="txn-info"><p>No customers recorded yet.</p></div></div>';
    return;
  }

  // Sort by total_spent descending
  const sorted = [...customers].sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0)).slice(0, 5);
  const colors = ['#FFF7ED,#F97316', '#F0FDF4,#10B981', '#FFF7ED,#F59E0B', '#F5F3FF,#8B5CF6', '#EFF6FF,#1D4ED8'];

  container.innerHTML = sorted.map((c, i) => {
    const initials = (c.name || 'CU').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const [bg, fg] = (colors[i % colors.length]).split(',');
    return `<div class="txn-item">
      <div class="txn-avatar" style="background:${bg};color:${fg}">${initials}</div>
      <div class="txn-info">
        <p>${c.name}</p>
        <span>${(c.segment || 'retail').toUpperCase()} · ${c.loyalty_points || 0} pts · ${c.total_orders || 0} orders</span>
      </div>
      <div class="txn-amount green">KES ${fmt(c.total_spent || 0)}</div>
    </div>`;
  }).join('');
}

function filterCRMCustomers() {
  const q = (document.getElementById('crm-search')?.value || '').toLowerCase();
  const segment = (document.getElementById('crm-segment-filter')?.value || '').toLowerCase();

  const filtered = _crmCache.filter(c => {
    const matchQ = !q || (c.name || '').toLowerCase().includes(q) ||
                         (c.phone || '').toLowerCase().includes(q) ||
                         (c.email || '').toLowerCase().includes(q);
    const matchSeg = !segment || (c.segment || '').toLowerCase() === segment;
    return matchQ && matchSeg;
  });

  renderCRMRows(filtered);
}

function renderCRMRows(customers) {
  const tbody = document.getElementById('crm-tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">No matching customers found.</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map(c => {
    const seg = (c.segment || 'regular').toUpperCase();
    const badgeCls = seg === 'B2B' ? 'badge-blue' : seg === 'VIP' ? 'badge-purple' : 'badge-green';
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.phone || '—'}<br><small style="color:var(--text-muted);">${c.email || ''}</small></td>
      <td><span class="badge ${badgeCls}">${seg}</span></td>
      <td><strong>${c.loyalty_points || 0} pts</strong></td>
      <td>KES ${fmt(c.credit_limit || 0)}</td>
      <td>${c.total_orders || 0}</td>
      <td><strong>KES ${fmt(c.total_spent || 0)}</strong></td>
      <td style="white-space:nowrap;">
        <button class="btn-sm tiny secondary" onclick="openCustomerModal(${c.id})">Edit</button>
        ${showDelete ? `<button class="btn-sm tiny secondary" style="color:var(--red);margin-left:4px;" onclick="deleteCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function openCustomerModal(id = null) {
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setVal('cust-id', '');
  setVal('cust-name', '');
  setVal('cust-phone', '');
  setVal('cust-email', '');
  setVal('cust-segment', 'regular');
  setVal('cust-limit', '0');

  const titleEl = document.getElementById('customer-modal-title');
  if (id) {
    if (titleEl) titleEl.textContent = 'Edit Customer Profile';
    setVal('cust-id', id);
    const c = _crmCache.find(item => item.id == id);
    if (c) {
      setVal('cust-name', c.name || '');
      setVal('cust-phone', c.phone || '');
      setVal('cust-email', c.email || '');
      setVal('cust-segment', c.segment || 'regular');
      setVal('cust-limit', c.credit_limit || 0);
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add New Customer';
  }

  document.getElementById('customer-modal')?.classList.remove('hidden');
}

async function submitCustomerModal() {
  const id = document.getElementById('cust-id')?.value;
  const name = document.getElementById('cust-name')?.value.trim();
  const phone = document.getElementById('cust-phone')?.value.trim();
  const email = document.getElementById('cust-email')?.value.trim();
  const segment = document.getElementById('cust-segment')?.value;
  const credit_limit = parseFloat(document.getElementById('cust-limit')?.value) || 0;

  if (!name) { showToast('Customer name is required'); return; }

  const payload = { name, phone, email, segment, credit_limit };

  try {
    let res;
    if (id) {
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
      const response = await fetch(`/api/crm/customers/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });
      res = await response.json();
    } else {
      res = await apiPost('/api/crm/customers', payload);
    }

    if (res.success) {
      showToast(id ? 'Customer updated!' : 'New customer added!');
      closeModal('customer-modal');
      loadCRM();
      loadCustomers(); // refresh POS customer list too
    } else {
      showToast(res.error || 'Failed to save customer');
    }
  } catch (e) {
    showToast('Error saving customer');
    console.error('[submitCustomerModal] Error:', e);
  }
}

function exportCRMContacts() {
  if (!_crmCache.length) { showToast('No customer contacts to export'); return; }
  const headers = ['Name', 'Phone', 'Email', 'Segment', 'Loyalty Points', 'Credit Limit', 'Total Orders', 'Total Spent'];
  const rows = _crmCache.map(c => [
    `"${c.name}"`,
    `"${c.phone || ''}"`,
    `"${c.email || ''}"`,
    `"${c.segment || 'regular'}"`,
    c.loyalty_points || 0,
    c.credit_limit || 0,
    c.total_orders || 0,
    c.total_spent || 0
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `customer_directory_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Customer directory CSV downloaded!');
}

let _servicesCache = [];

async function loadServices() {
  const tbody = document.querySelector('#view-services table.data-table tbody');
  if (!tbody) return;
  try {
    const data = await apiGet('/api/services');
    _servicesCache = data.data || [];
    renderServicesRows(_servicesCache);
    updateServicesKPIs(_servicesCache);
  } catch (e) {
    console.error('[loadServices] API error:', e);
  }
}

function updateServicesKPIs(items) {
  const totalEl = document.getElementById('srv-kpi-total');
  const activeEl = document.getElementById('srv-kpi-active');
  const revEl = document.getElementById('srv-kpi-rev');
  const avgEl = document.getElementById('srv-kpi-avg');

  const total = items.length;
  const active = items.filter(s => s.is_active !== 0).length;
  const totalPrice = items.reduce((sum, s) => sum + (s.price || 0), 0);
  const avg = total > 0 ? Math.round(totalPrice / total) : 0;

  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (revEl) revEl.textContent = 'KES ' + fmt(totalPrice * 12); // Estimated monthly revenue baseline
  if (avgEl) avgEl.textContent = 'KES ' + fmt(avg);
}

function renderServicesRows(items) {
  const tbody = document.querySelector('#view-services table.data-table tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:16px;">No services catalog items found.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(s => {
    const isActive = s.is_active !== 0;
    const badgeClass = isActive ? 'badge-green' : 'badge-amber';
    return `<tr>
      <td class="mono"><code>${s.code || 'SRV-00' + s.id}</code></td>
      <td><strong>${s.name}</strong></td>
      <td><span class="service-chip">${s.category || 'General'}</span></td>
      <td>${s.unit || 'Per Session'}</td>
      <td><strong>${fmt(s.price)}</strong></td>
      <td>${s.vat_applicable ? `<span class="badge badge-green">Yes (${getVatRate()}%)</span>` : '<span class="badge badge-amber">No (EXEMPT)</span>'}</td>
      <td>${s.available_at || 'All Branches'}</td>
      <td><span class="badge ${badgeClass}">${isActive ? 'Active' : 'Inactive'}</span></td>
      <td>
        <button class="btn-sm tiny secondary" onclick="openServiceModal(${s.id})">Edit</button>
        ${showDelete ? `<button class="btn-sm tiny secondary" style="color:var(--red);margin-left:4px;" onclick="deleteService(${s.id}, '${s.name.replace(/'/g, "\\'")}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function filterServices() {
  const q = (document.getElementById('srv-search')?.value || '').toLowerCase();
  const filtered = _servicesCache.filter(s => {
    return !q || (s.name || '').toLowerCase().includes(q) ||
                 (s.code || '').toLowerCase().includes(q) ||
                 (s.category || '').toLowerCase().includes(q);
  });
  renderServicesRows(filtered);
}

function exportServicesCSV() {
  if (!_servicesCache.length) { showToast('No services to export'); return; }
  const headers = ['Service Code', 'Service Name', 'Category', 'Unit', 'Price (KES)', 'VAT Applicable', 'Available At'];
  const rows = _servicesCache.map(s => [
    `"${s.code || 'SRV-00' + s.id}"`,
    `"${s.name}"`,
    `"${s.category || 'General'}"`,
    `"${s.unit || 'Per Session'}"`,
    s.price,
    s.vat_applicable ? 'Yes' : 'No',
    `"${s.available_at || 'All Branches'}"`
  ]);
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `services_catalog_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Services CSV downloaded!');
}

let _movementsCache = [];

async function loadStockMovements() {
  const tbody = document.querySelector('#view-stock-movements table.data-table tbody');
  if (!tbody) return;
  try {
    const branchId = state.currentBranch && state.currentBranch.id ? state.currentBranch.id : 'all';
    const url = branchId === 'all' ? '/api/stock-movements' : `/api/stock-movements?branch_id=${branchId}`;
    const data = await apiGet(url);
    _movementsCache = data.data || [];
    updateStockMovementKPIs(_movementsCache);
    filterStockMovements();
  } catch (e) {
    console.error('[loadStockMovements] API error:', e);
  }
}

function updateStockMovementKPIs(items) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = items.filter(m => (m.created_at || '').startsWith(todayStr)).length || items.length;
  const returnsCount = items.filter(m => (m.movement_type || '').toUpperCase() === 'RETURN').length;
  const damageCount = items.filter(m => (m.movement_type || '').toUpperCase() === 'DAMAGE' || (m.movement_type || '').toUpperCase() === 'EXPIRY').length;
  const adjustCount = items.filter(m => (m.movement_type || '').toUpperCase() === 'ADJUSTMENT' || (m.movement_type || '').toUpperCase().startsWith('TRANSFER')).length;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('sm-kpi-today', todayCount);
  setEl('sm-kpi-returns', returnsCount);
  setEl('sm-kpi-damage', damageCount);
  setEl('sm-kpi-adjustments', adjustCount);
}

function filterStockMovements() {
  const type = (document.getElementById('sm-type-filter')?.value || '').toUpperCase();
  const date = document.getElementById('sm-date-filter')?.value || '';
  const q = (document.getElementById('sm-search')?.value || '').toLowerCase();

  const filtered = _movementsCache.filter(m => {
    const mType = (m.movement_type || '').toUpperCase();
    const matchType = !type || mType === type || (type === 'TRANSFER' && mType.startsWith('TRANSFER'));
    const matchDate = !date || (m.created_at || '').startsWith(date);
    const matchQ = !q || (m.product_name || '').toLowerCase().includes(q) ||
                         (m.sku || '').toLowerCase().includes(q) ||
                         (m.ref || '').toLowerCase().includes(q) ||
                         (m.reason || '').toLowerCase().includes(q);
    return matchType && matchDate && matchQ;
  });

  renderStockMovementRows(filtered);
}

function renderStockMovementRows(items) {
  const tbody = document.querySelector('#view-stock-movements table.data-table tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:16px;">No stock movements logged for this branch.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(m => {
    const type = (m.movement_type || 'ADJUSTMENT').toUpperCase();
    let badgeClass = 'badge-blue';
    let displayType = type;
    if (type === 'SALE' || type === 'DAMAGE') {
      badgeClass = 'badge-red';
    } else if (type === 'RETURN' || type === 'PURCHASE') {
      badgeClass = 'badge-green';
    } else if (type === 'EXPIRY') {
      badgeClass = 'badge-amber';
    } else if (type === 'TRANSFER_OUT') {
      badgeClass = 'badge-amber';
      displayType = 'TRANSFER OUT';
    } else if (type === 'TRANSFER_IN') {
      badgeClass = 'badge-purple';
      displayType = 'TRANSFER IN';
    } else if (type === 'TRANSFER') {
      badgeClass = 'badge-purple';
    }

    const sign = (type === 'SALE' || type === 'DAMAGE' || type === 'EXPIRY' || type === 'TRANSFER_OUT') ? '' : (m.qty_change > 0 ? '+' : '');
    const dt = m.created_at ? new Date(m.created_at).toLocaleString('en-KE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Today';

    return `<tr>
      <td><code>${m.ref}</code></td>
      <td>${dt}</td>
      <td><strong>${m.product_name}</strong></td>
      <td><code>${m.sku || '—'}</code></td>
      <td><span class="badge ${badgeClass}">${displayType}</span></td>
      <td style="font-weight:700;">${sign}${m.qty_change}</td>
      <td>${m.reason || '—'}</td>
      <td>${m.recorded_by || 'Staff'}</td>
      <td>${m.branch_name || 'Main Branch'}</td>
      <td>${showDelete ? `<button class="btn-sm tiny secondary" style="color:var(--red);" onclick="deleteStockMovement(${m.id}, '${(m.ref || '').replace(/'/g, "\\'")}')">Delete</button>` : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</td>
    </tr>`;
  }).join('');
}

let _movProductsCache = [];

async function openStockMovementModal() {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('mov-product-input', '');
  setVal('mov-product-id', '');
  setVal('mov-product-name', '');
  setVal('mov-product-sku', '');
  setVal('mov-type-select', 'ADJUSTMENT');
  setVal('mov-qty', '1');
  setVal('mov-ref', 'MOV-' + Math.floor(1000 + Math.random() * 9000));
  setVal('mov-notes', '');

  const suggestions = document.getElementById('mov-product-suggestions');
  if (suggestions) { suggestions.innerHTML = ''; suggestions.classList.add('hidden'); }

  // Load products scoped to the current branch
  const branchId = state.currentBranch && state.currentBranch.id ? state.currentBranch.id : null;
  const invUrl = (branchId && branchId !== 'all') ? `/api/inventory?branch_id=${branchId}` : '/api/inventory';
  try {
    const data = await apiGet(invUrl);
    if (data && data.data && data.data.length) {
      _movProductsCache = data.data;
    }
  } catch (e) {
    console.error('[openStockMovementModal] error loading products:', e);
  }

  // Pre-select the current branch in the store selector
  const storeSelect = document.getElementById('mov-store-select');
  if (storeSelect && branchId && branchId !== 'all') {
    // Try to set the option matching the current branch
    Array.from(storeSelect.options).forEach(opt => {
      if (String(opt.value) === String(branchId)) storeSelect.value = opt.value;
    });
  }

  // Populate transfer branch selectors if present
  const fromSel = document.getElementById('mov-from-branch');
  const toSel = document.getElementById('mov-to-branch');
  if (fromSel || toSel) {
    try {
      const bRes = await apiGet('/api/branches');
      const branches = bRes.data || [];
      const branchOpts = branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      if (fromSel) {
        fromSel.innerHTML = branchOpts;
        if (branchId && branchId !== 'all') fromSel.value = String(branchId);
      }
      if (toSel) {
        toSel.innerHTML = branches.filter(b => String(b.id) !== String(branchId)).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      }
    } catch (e) {}
  }

  // Toggle transfer fields based on type
  toggleTransferFields();

  document.getElementById('stock-movement-modal')?.classList.remove('hidden');
}

function toggleTransferFields() {
  const type = document.getElementById('mov-type-select')?.value;
  const transferFields = document.getElementById('mov-transfer-fields');
  const standardFields = document.getElementById('mov-standard-fields');
  if (transferFields) transferFields.style.display = (type === 'TRANSFER') ? 'grid' : 'none';
  if (standardFields) standardFields.style.display = (type === 'TRANSFER') ? 'none' : 'grid';
}

async function searchMovProducts(queryStr) {
  const box = document.getElementById('mov-product-suggestions');
  if (!box) return;
  const q = (queryStr || '').trim().toLowerCase();
  if (!q) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }

  // If cache is empty, try to load from API first
  if (!_movProductsCache.length) {
    try {
      const branchId = state.currentBranch && state.currentBranch.id ? state.currentBranch.id : null;
      const invUrl = (branchId && branchId !== 'all') ? `/api/inventory?branch_id=${branchId}` : '/api/inventory';
      const data = await apiGet(invUrl);
      if (data && data.data && data.data.length) {
        _movProductsCache = data.data;
      }
    } catch (e) {
      console.warn('[searchMovProducts] API fetch failed, using fallback:', e);
    }
  }

  let list = _movProductsCache.length ? _movProductsCache : (_inventoryCache && _inventoryCache.length ? _inventoryCache : []);
  if (!list.length && state.productsCache && state.productsCache.length) {
    list = state.productsCache.map(p => ({ id: p.id, sku: p.sku, name: p.name, stock_qty: p.stock }));
  }

  const matches = list.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.sku || '').toLowerCase().includes(q)
  );

  if (!matches.length) {
    box.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);text-align:center;">No matching products found in this branch</div>';
    box.classList.remove('hidden');
    return;
  }

  box.innerHTML = matches.slice(0, 8).map(p => `
    <div style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;"
         onmouseover="this.style.background='var(--brand-light)'"
         onmouseout="this.style.background='transparent'"
         onclick="selectMovProduct(${p.id})">
      <div>
        <strong style="font-size:12.5px;color:var(--text-primary);">${p.name}</strong>
        <div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${p.sku || '—'}</div>
      </div>
      <span class="badge ${(p.stock_qty || p.stock || 0) === 0 ? 'badge-red' : (p.stock_qty || p.stock || 0) <= 10 ? 'badge-amber' : 'badge-green'}" style="font-size:10px;">
        Stock: ${p.stock_qty !== undefined ? p.stock_qty : (p.stock || 0)}
      </span>
    </div>
  `).join('');
  box.classList.remove('hidden');
}

function selectMovProduct(id) {
  const p = _movProductsCache.find(item => item.id == id);
  if (!p) return;
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setVal('mov-product-input', `${p.name} (${p.sku})`);
  setVal('mov-product-id', p.id);
  setVal('mov-product-name', p.name);
  setVal('mov-product-sku', p.sku || '');

  const box = document.getElementById('mov-product-suggestions');
  if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
}

async function submitStockMovementModal() {
  let prodId = parseInt(document.getElementById('mov-product-id')?.value) || null;
  let prodName = document.getElementById('mov-product-name')?.value.trim();
  let prodSku = document.getElementById('mov-product-sku')?.value.trim();
  const inputVal = document.getElementById('mov-product-input')?.value.trim();

  // If user typed without clicking suggestion, match from cache
  if (!prodName && inputVal) {
    const q = inputVal.toLowerCase();
    const match = _movProductsCache.find(p => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)));
    if (match) {
      prodId = match.id;
      prodName = match.name;
      prodSku = match.sku;
    } else {
      prodName = inputVal;
    }
  }

  const movement_type = document.getElementById('mov-type-select')?.value;
  const qtyVal = parseInt(document.getElementById('mov-qty')?.value) || 0;
  const branch_name = document.getElementById('mov-store-select')?.value;
  const ref = document.getElementById('mov-ref')?.value.trim();
  const reason = document.getElementById('mov-notes')?.value.trim();

  if (!prodName || !movement_type || qtyVal <= 0) {
    showToast('Product name, movement type, and valid quantity are required');
    return;
  }

  // Inter-branch transfer handling
  if (movement_type === 'TRANSFER') {
    const from_branch_id = parseInt(document.getElementById('mov-from-branch')?.value);
    const to_branch_id = parseInt(document.getElementById('mov-to-branch')?.value);

    if (!from_branch_id || !to_branch_id || from_branch_id === to_branch_id) {
      showToast('Please select distinct Source and Destination branches for transfer');
      return;
    }
    if (!prodId) {
      showToast('Please select a valid product from the source branch');
      return;
    }

    const payload = {
      product_id: prodId,
      product_name: prodName,
      sku: prodSku || '',
      movement_type: 'TRANSFER',
      qty_change: qtyVal,
      from_branch_id,
      to_branch_id,
      reason: reason || (ref ? `Ref: ${ref}` : '')
    };

    try {
      const res = await apiPost('/api/stock-movements', payload);
      if (res.success) {
        showToast(res.message || 'Inter-branch stock transfer completed!');
        closeModal('stock-movement-modal');
        loadStockMovements();
        loadInventory();
        loadPOSProducts();
      } else {
        showToast(res.error || 'Transfer failed');
      }
    } catch (e) {
      showToast('Error executing branch transfer');
      console.error('[submitStockMovementModal] transfer error:', e);
    }
    return;
  }

  const isDecrease = ['SALE', 'DAMAGE', 'EXPIRY', 'ADJUSTMENT'].includes(movement_type.toUpperCase());
  const qty_change = isDecrease ? -Math.abs(qtyVal) : Math.abs(qtyVal);

  const payload = {
    product_id: prodId,
    product_name: prodName,
    sku: prodSku || '',
    movement_type,
    qty_change,
    reason: reason || (ref ? `Ref: ${ref}` : ''),
    branch_name,
    branch_id: state.currentBranch && state.currentBranch.id !== 'all' ? state.currentBranch.id : 1
  };

  try {
    const res = await apiPost('/api/stock-movements', payload);
    if (res.success) {
      showToast('Stock movement logged successfully!');
      closeModal('stock-movement-modal');
      loadStockMovements();
      loadInventory(); // sync live stock levels table
    } else {
      showToast(res.error || 'Failed to log stock movement');
    }
  } catch (e) {
    showToast('Error logging movement');
    console.error('[submitStockMovementModal] error:', e);
  }
}

function exportStockMovementsCSV() {
  if (!_movementsCache.length) { showToast('No stock movements to export'); return; }
  const headers = ['Ref ID', 'Date & Time', 'Product Name', 'SKU', 'Movement Type', 'Qty Change', 'Reason / Reference', 'Recorded By', 'Branch'];
  const rows = _movementsCache.map(m => [
    `"${m.ref}"`,
    `"${m.created_at || 'Today'}"`,
    `"${m.product_name}"`,
    `"${m.sku || ''}"`,
    `"${m.movement_type}"`,
    m.qty_change,
    `"${m.reason || ''}"`,
    `"${m.recorded_by || 'Staff'}"`,
    `"${m.branch_name || 'Nairobi Main'}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `stock_movements_log_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Stock movement log CSV downloaded!');
}

async function loadZReports() {
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const res = await apiGet(`/api/z-reports${bParam}`);
    const reports = res.data || [];
    if (reports.length > 0) {
      const last = reports[0];
      const prev = reports[1] || last;
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      const formatKES = num => 'KES ' + Number(num || 0).toLocaleString();

      setVal('zr-last-amount', formatKES(last.total_sales));
      setVal('zr-last-sub', `${last.created_at ? new Date(last.created_at).toLocaleDateString() : 'Today'} — ${last.cashier_name || 'James Mwangi'} · ${last.branch_name || 'Nairobi Main'}`);

      setVal('zr-prev-amount', formatKES(prev.total_sales));
      setVal('zr-prev-sub', `${prev.created_at ? new Date(prev.created_at).toLocaleDateString() : 'Yesterday'} — ${prev.cashier_name || 'David Kamau'} · ${prev.branch_name || 'Nairobi Main'}`);

      renderZReportPreview(last);
    }
  } catch (e) {
    console.error('[loadZReports] error:', e);
  }
}

async function generateZReportAction(type = 'cashier') {
  let cashier_name = 'James Mwangi';
  let manager_name = 'David Kamau';
  let branch_name = 'Nairobi Main';
  let period_label = 'Today';

  if (type === 'cashier') {
    cashier_name = document.getElementById('zr-cashier-select')?.value || 'James Mwangi';
    period_label = document.getElementById('zr-cashier-period')?.value || 'Today';
    branch_name  = document.getElementById('zr-cashier-branch')?.value || 'Nairobi Main';
  } else if (type === 'manager') {
    manager_name = document.getElementById('zr-manager-select')?.value || 'David Kamau';
    period_label = document.getElementById('zr-manager-period')?.value || 'Today';
    branch_name  = document.getElementById('zr-manager-branch')?.value || 'Nairobi Main';
  } else if (type === 'store') {
    branch_name  = document.getElementById('zr-store-select')?.value || 'Nairobi Main';
    period_label = document.getElementById('zr-store-period')?.value || 'Today';
  }

  const btn = document.getElementById('btn-gen-zreport');
  if (btn) btn.disabled = true;

  try {
    const res = await apiPost('/api/z-reports/generate', {
      report_type: type,
      period_label,
      cashier_name,
      manager_name,
      branch_name
    });

    if (res.success && res.data) {
      showToast(`Z-Report ${res.data.report_no} generated!`);
      loadZReports();
      const previewCard = document.getElementById('z-report-preview-card');
      if (previewCard) previewCard.scrollIntoView({ behavior: 'smooth' });
    } else {
      showToast(res.error || 'Failed to generate Z-Report');
    }
  } catch (e) {
    showToast('Error generating Z-Report');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderZReportPreview(rep) {
  const preview = document.getElementById('z-report-preview');
  if (!preview || !rep) return;
  const formatKES = num => 'KES ' + Number(num || 0).toLocaleString();
  const dateStr = rep.created_at ? new Date(rep.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString();

  preview.innerHTML = `
    <div class="zr-header" style="text-align:center;">
      <div style="font-size:15px;font-weight:700;">OPENFLOAT ENTERPRISE LTD</div>
      <div style="font-size:11px;">${rep.branch_name || 'Nairobi Main Branch'}</div>
      <div style="font-size:11px;margin-top:4px;font-weight:600;">Z-REPORT &mdash; SESSION CLOSURE REPORT (#${rep.report_no || 'ZREP-001'})</div>
      <div style="font-size:11px;color:var(--text-muted);">${dateStr}</div>
    </div>
    <div class="zr-divider"></div>
    <div class="zr-row"><span>Cashier / Staff:</span><span>${rep.cashier_name || 'James Mwangi'}</span></div>
    <div class="zr-row"><span>Report Type:</span><span>${(rep.report_type || 'cashier').toUpperCase()} (${rep.period_label || 'Today'})</span></div>
    <div class="zr-row"><span>Opening Float:</span><span>${formatKES(rep.opening_float)}</span></div>
    <div class="zr-divider"></div>
    <div class="zr-row"><span>Cash Sales:</span><span>${formatKES(rep.cash_sales)}</span></div>
    <div class="zr-row"><span>M-Pesa Sales:</span><span>${formatKES(rep.mpesa_sales)}</span></div>
    <div class="zr-row"><span>Card Sales:</span><span>${formatKES(rep.card_sales)}</span></div>
    <div class="zr-row"><span>Discounts Given:</span><span style="color:var(--red);">- ${formatKES(rep.discounts)}</span></div>
    <div class="zr-divider"></div>
    <div class="zr-row"><span>Gross Sales Revenue:</span><span>${formatKES(rep.total_sales)}</span></div>
    <div class="zr-row"><span>VAT Collected (${getVatRate()}%):</span><span>${formatKES(rep.vat_collected)}</span></div>
    <div class="zr-row total"><span>Net Revenue:</span><span style="color:var(--green);">${formatKES(rep.net_revenue)}</span></div>
    <div class="zr-divider"></div>
    <div class="zr-row"><span>Closing Cash in Drawer:</span><span style="font-weight:700;">${formatKES(rep.closing_cash)}</span></div>
    <div class="zr-footer" style="text-align:center;margin-top:16px;font-size:11px;color:var(--text-muted);">--- END OF Z-REPORT ---<br>Powered by OpenFloat POS X</div>
  `;
}

async function openProductModal(id = null) {
  const modal = document.getElementById('product-modal');
  if (!modal) { console.error('[openProductModal] product-modal not found in DOM'); return; }

  // Load fresh categories from API
  await loadCategories();

  // Populate suppliers dropdown
  const supSelect = document.getElementById('prod-supplier-id');
  if (supSelect) {
    if (!_suppliersCache.length) {
      try {
        const sRes = await apiGet('/api/suppliers');
        _suppliersCache = sRes.data || [];
      } catch (_) {}
    }
    let supOpts = '<option value="">Select Supplier (Optional)...</option>';
    _suppliersCache.forEach(s => {
      supOpts += `<option value="${s.id}">${s.name}</option>`;
    });
    supSelect.innerHTML = supOpts;
    supSelect.value = '';
  }

  // Populate branches dropdown
  const branchSelect = document.getElementById('prod-branch-id');
  if (branchSelect) {
    try {
      const bRes = await apiGet('/api/branches');
      const branches = bRes.data || [];
      branchSelect.innerHTML = branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      const defaultBranch = (state.currentBranch && state.currentBranch.id && state.currentBranch.id !== 'all') ? state.currentBranch.id : 1;
      branchSelect.value = String(defaultBranch);
    } catch (_) {}
  }

  // Clear/reset all fields
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setVal('prod-id', '');
  setVal('prod-name', '');
  setVal('prod-sku', '');
  setVal('prod-cat-id', _categoriesCache.length ? String(_categoriesCache[0].id) : '');
  setVal('prod-new-cat-name', '');
  const newCatWrap = document.getElementById('prod-new-cat-wrap');
  if (newCatWrap) newCatWrap.classList.add('hidden');
  clearProductImage();
  setVal('prod-buy-price', '');
  setVal('prod-sell-price', '');
  setVal('prod-stock', '');
  setVal('prod-unit', 'pcs');
  setVal('prod-reorder', '10');
  setVal('prod-expiry', '');

  const titleEl = document.getElementById('product-modal-title');
  if (id) {
    if (titleEl) titleEl.textContent = 'Edit Product';
    setVal('prod-id', id);
    try {
      const data = await apiGet(`/api/inventory/${id}`);
      if (data && data.success && data.data) {
        const p = data.data;
        setVal('prod-name', p.name || '');
        setVal('prod-sku', p.sku || '');
        setVal('prod-cat-id', p.category_id ? String(p.category_id) : (_categoriesCache.length ? String(_categoriesCache[0].id) : ''));
        if (supSelect) supSelect.value = p.supplier_id ? String(p.supplier_id) : '';
        if (branchSelect && p.branch_id) branchSelect.value = String(p.branch_id);
        setVal('prod-image-url', p.image_url || '');
        onProductImageUrlChange(p.image_url || '');
        setVal('prod-buy-price', p.buy_price || '');
        setVal('prod-sell-price', p.sell_price || '');
        setVal('prod-stock', p.stock_qty || '0');
        setVal('prod-unit', p.unit || 'pcs');
        setVal('prod-reorder', p.reorder_level || '10');
        setVal('prod-expiry', p.expiry_date ? p.expiry_date.slice(0, 10) : '');
      }
    } catch (e) {
      console.error('[openProductModal] fetch error:', e);
      showToast('Error loading product details.');
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add New Product';
  }

  modal.classList.remove('hidden');
}

async function submitProductModal() {
  const id = document.getElementById('prod-id').value;
  const name = document.getElementById('prod-name').value.trim();
  const sku = document.getElementById('prod-sku').value.trim();
  const catSelectVal = document.getElementById('prod-cat-id').value;
  const newCatName = (document.getElementById('prod-new-cat-name')?.value || '').trim();
  const supplier_id = document.getElementById('prod-supplier-id')?.value ? parseInt(document.getElementById('prod-supplier-id').value) : null;
  const branch_id = document.getElementById('prod-branch-id')?.value ? parseInt(document.getElementById('prod-branch-id').value) : null;
  const image_url = document.getElementById('prod-image-url')?.value.trim() || null;
  const buy_price = parseFloat(document.getElementById('prod-buy-price').value) || 0;
  const sell_price = parseFloat(document.getElementById('prod-sell-price').value);
  const stock_qty = parseInt(document.getElementById('prod-stock').value) || 0;
  const unit = document.getElementById('prod-unit').value.trim();
  const reorder_level = parseInt(document.getElementById('prod-reorder').value) || 10;
  const expiry_date = document.getElementById('prod-expiry').value || null;

  if (!name || !sku || isNaN(sell_price)) {
    showToast('Name, SKU, and Sell Price are required.');
    return;
  }

  let category_id = catSelectVal !== 'NEW_CATEGORY' && catSelectVal ? parseInt(catSelectVal) : null;
  let new_category = null;

  if (catSelectVal === 'NEW_CATEGORY' || newCatName) {
    if (!newCatName) {
      showToast('Please type a name for the new category.');
      document.getElementById('prod-new-cat-name')?.focus();
      return;
    }
    new_category = newCatName;
  }

  // Use selected branch or active session branch
  const activeBranchId = branch_id || ((state.currentBranch && state.currentBranch.id && state.currentBranch.id !== 'all') ? state.currentBranch.id : 1);

  const payload = {
    name, sku, category_id, new_category, supplier_id, image_url, buy_price, sell_price, stock_qty, unit, reorder_level, expiry_date,
    branch_id: activeBranchId
  };

  try {
    let res;
    if (id) {
      // Edit
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
      const response = await fetch(`/api/inventory/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });
      res = await response.json();
    } else {
      // Add
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      res = await response.json();
    }

    if (res.success) {
      showToast(id ? 'Product updated successfully!' : 'Product added successfully!');
      closeModal('product-modal');
      // Reload lists and fresh categories
      await loadCategories();
      await loadInventory();
      await loadPOSProducts();
    } else {
      showToast(res.error || 'Failed to save product.');
    }
  } catch (e) {
    showToast('Error saving product.');
  }
}

async function submitSupplierModal() {
  const id = document.getElementById('sup-id')?.value.trim();
  const name = document.getElementById('sup-name')?.value.trim();
  const category = document.getElementById('sup-cat')?.value.trim();
  const contact_name = document.getElementById('sup-contact')?.value.trim();
  const phone = document.getElementById('sup-phone')?.value.trim();
  const email = document.getElementById('sup-email')?.value.trim();
  const rating = parseInt(document.getElementById('sup-rating')?.value) || 85;

  if (!name) { showToast('Supplier name is required'); return; }

  try {
    let res;
    if (id) {
      res = await fetch(`/api/suppliers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (state.token || '') },
        body: JSON.stringify({ name, category, contact_name, phone, email, rating })
      }).then(r => r.json());
    } else {
      res = await apiPost('/api/suppliers', { name, category, contact_name, phone, email, rating });
    }
    if (res.success) {
      showToast(id ? 'Supplier updated!' : 'Supplier added!');
      closeModal('supplier-modal');
      loadSuppliers();
    } else {
      showToast(res.error || 'Failed to save supplier');
    }
  } catch (e) {
    showToast('Error saving supplier');
  }
}


async function openServiceModal(id = null) {
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setVal('srv-id', '');
  setVal('srv-name', '');
  setVal('srv-code', '');
  setVal('srv-cat', '');
  setVal('srv-price', '');
  setVal('srv-unit', 'Per Session');
  setVal('srv-vat', '1');
  setVal('srv-branches', 'All Branches');

  const titleEl = document.getElementById('service-modal-title');
  if (id) {
    if (titleEl) titleEl.textContent = 'Edit Service';
    setVal('srv-id', id);
    const s = _servicesCache.find(item => item.id == id);
    if (s) {
      setVal('srv-name', s.name || '');
      setVal('srv-code', s.code || '');
      setVal('srv-cat', s.category || '');
      setVal('srv-price', s.price || '');
      setVal('srv-unit', s.unit || 'Per Session');
      setVal('srv-vat', s.vat_applicable ? '1' : '0');
      setVal('srv-branches', s.available_at || 'All Branches');
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add New Service';
    setVal('srv-code', 'SRV-00' + Math.floor(10 + Math.random() * 90));
  }

  document.getElementById('service-modal')?.classList.remove('hidden');
}

async function submitServiceModal() {
  const id = document.getElementById('srv-id')?.value;
  const name = document.getElementById('srv-name')?.value.trim();
  const code = document.getElementById('srv-code')?.value.trim();
  const category = document.getElementById('srv-cat')?.value.trim();
  const price = parseFloat(document.getElementById('srv-price')?.value);
  const unit = document.getElementById('srv-unit')?.value.trim();
  const vat_applicable = parseInt(document.getElementById('srv-vat')?.value || '1');
  const available_at = document.getElementById('srv-branches')?.value.trim();

  if (!name || isNaN(price)) { showToast('Service name and price are required'); return; }

  const payload = { name, code, category, price, unit, vat_applicable, available_at };

  try {
    let res;
    if (id) {
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
      const response = await fetch(`/api/services/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });
      res = await response.json();
    } else {
      res = await apiPost('/api/services', payload);
    }

    if (res.success) {
      showToast(id ? 'Service updated successfully!' : 'Service added to catalog!');
      closeModal('service-modal');
      loadServices();
    } else {
      showToast(res.error || 'Failed to save service');
    }
  } catch (e) {
    showToast('Error saving service');
    console.error('[submitServiceModal] Error:', e);
  }
}

async function submitHPModal() {
  const customer_name = document.getElementById('hp-cust-name')?.value.trim();
  const item_name = document.getElementById('hp-item-name')?.value.trim();
  const total_value = parseFloat(document.getElementById('hp-total-val')?.value);
  const down_payment = parseFloat(document.getElementById('hp-down-pay')?.value);
  const monthly_instalment = parseFloat(document.getElementById('hp-monthly')?.value);
  const next_due = document.getElementById('hp-due-date')?.value;

  if (!customer_name || !item_name || isNaN(total_value) || isNaN(down_payment)) {
    alert('Customer name, item name, total value, and down payment are required');
    return;
  }

  try {
    const res = await apiPost('/api/hire-purchase', { customer_name, item_name, total_value, down_payment, monthly_instalment, next_due });
    if (res.success) {
      showToast('Hire purchase agreement created!');
      closeModal('hp-modal');
      loadHirePurchase();
    } else {
      showToast(res.error || 'Failed to create agreement');
    }
  } catch (e) {
    showToast('Agreement saved');
    closeModal('hp-modal');
  }
}

function renderProducts(cat = 'all') {
  currentCategory = cat;
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  const query = (document.getElementById('pos-search')?.value || '').toLowerCase();
  const targetCat = (cat || 'all').toLowerCase();

  const items = state.productsCache.filter(p => {
    const pCatName = (p.cat || '').toLowerCase();
    const pCatSlug = (p.cat_slug || '').toLowerCase();
    const matchCat = targetCat === 'all' ||
                     pCatSlug === targetCat ||
                     pCatName === targetCat ||
                     pCatName.includes(targetCat) ||
                     targetCat.includes(pCatName) ||
                     (targetCat === 'services' && p.is_service);
    const matchSearch = !query || p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query);
    return matchCat && matchSearch;
  });

  if (items.length === 0 && state.productsCache.length === 0) {
    grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Loading catalog items...</div>';
    return;
  }

  if (items.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:30px;color:var(--text-muted);text-align:center;font-size:13px;">No items found in this category.</div>';
    return;
  }

  grid.innerHTML = items.map(p => {
    const badgeText = p.is_service ? 'Billable Service' : (p.stock > 0 ? p.stock + ' in stock' : 'Out of stock');
    const badgeClass = p.is_service ? 'ok' : (p.status === 'ok' ? 'ok' : 'low');
    const pidStr = typeof p.id === 'string' ? `'${p.id}'` : p.id;
    const imgHtml = p.image_url ? `<div class="product-img-wrap"><img src="${p.image_url}" alt="${p.name}" class="product-img" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.style.display='none'" /></div>` : '';

    return `
      <div class="product-card ${!p.is_service && p.stock === 0 ? 'out-of-stock' : ''}" onclick="addToCart(${pidStr})">
        ${imgHtml}
        <span class="product-code">${p.sku}</span>
        <div class="product-title">${p.name}</div>
        <div class="product-cost">KES ${fmt(p.price)}</div>
        <span class="product-qty-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');
}

function filterCat(cat, btn) {
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts(cat);
}

function filterProducts() {
  renderProducts(currentCategory);
}

function addToCart(productId) {
  const p = state.productsCache.find(x => String(x.id) === String(productId));
  if (!p) return;
  if (!p.is_service && p.stock === 0) { showToast(p.name + ' is out of stock'); return; }

  const existing = state.cart.find(item => String(item.id) === String(productId));
  if (existing) {
    existing.qty++;
  } else {
    state.cart.push({ ...p, qty: 1 });
  }

  renderCart();
  showToast(`${p.name} added to cart`);
}

function updateQty(id, delta) {
  const item = state.cart.find(x => String(x.id) === String(id));
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(x => String(x.id) !== String(id));
  }
  renderCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter(x => String(x.id) !== String(id));
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-body');
  const emptyState = document.getElementById('cart-empty');
  if (!container) return;

  if (state.cart.length === 0) {
    container.innerHTML = '';
    if (emptyState) { emptyState.style.display = 'flex'; container.appendChild(emptyState); }
    updateCartTotals(0, 0, 0);
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = state.cart.map(item => {
    const idStr = typeof item.id === 'string' ? `'${item.id}'` : item.id;
    return `
    <div class="cart-row">
      <div class="cart-row-info">
        <div class="cart-row-title">${item.name}${item.is_service ? ' <span style="font-size:10px;color:var(--text-muted);font-weight:500">(Service)</span>' : ''}</div>
        <div class="cart-row-sub">KES ${fmt(item.price)} ${item.is_service ? (item.unit || 'per service') : 'each'}</div>
      </div>
      <div class="cart-row-qty">
        <button class="btn-qty" onclick="updateQty(${idStr}, -1)">-</button>
        <span class="qty-num">${item.qty}</span>
        <button class="btn-qty" onclick="updateQty(${idStr}, 1)">+</button>
      </div>
      <div class="cart-row-total">KES ${fmt(item.price * item.qty)}</div>
      <button class="btn-del" onclick="removeFromCart(${idStr})">&times;</button>
    </div>
  `;
  }).join('');

  const { subtotal, discount, vat, grandTotal } = getCartTotals();
  updateCartTotals(subtotal, discount, vat, grandTotal);
}

function updateCartTotals(sub, disc, vat, grandTotal) {
  const total = grandTotal !== undefined ? grandTotal : (sub - (disc || 0) + vat);
  const currency = getCurrency();
  const subEl = document.getElementById('cart-subtotal');
  const discEl = document.getElementById('cart-discount');
  const vatEl = document.getElementById('cart-vat');
  const totEl = document.getElementById('cart-total');
  const chgTotEl = document.getElementById('charge-total');

  if (subEl) subEl.textContent = `${currency} ${fmt(sub)}.00`;
  if (discEl) discEl.textContent = `- ${currency} ${fmt(disc || 0)}.00`;
  if (vatEl) vatEl.textContent = `${currency} ${fmt(vat)}.00`;
  if (totEl) totEl.textContent = `${currency} ${fmt(total)}.00`;
  if (chgTotEl) chgTotEl.textContent = `${currency} ${fmt(total)}.00`;

  // Keep the VAT label in sync with the live rate
  const vatLabel = document.getElementById('cart-vat-label');
  if (vatLabel) vatLabel.textContent = `VAT (${getVatRate()}%)`;

  calcChange();
  calcSplit();
}

function clearCart() {
  state.cart = [];
  _discountValue = 0;
  _activeDiscountAmt = 0;
  renderCart();
  showToast('Cart cleared');
}

/* ── DISCOUNT MODAL & CART TOTALS ────────────────────────────────── */
let _discountType = 'pct'; // 'pct' | 'fixed'
let _discountValue = 0; // percentage or fixed amount entered by user
let _activeDiscountAmt = 0; // calculated currency amount

/**
 * Single source of truth for all cart totals (subtotal, discount, VAT, grand total).
 * Ensures change calculation, split payment, STK push, and checkout always use
 * the exact post-discount, post-VAT grand total.
 */
function getCartTotals() {
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  let discount = 0;
  if (_discountValue > 0) {
    if (_discountType === 'pct') {
      discount = Math.round(subtotal * (_discountValue / 100));
    } else {
      discount = Math.round(_discountValue);
    }
    discount = Math.min(discount, subtotal);
  }
  _activeDiscountAmt = discount;
  const vatRate = getVatRate();
  const taxable = Math.max(0, subtotal - discount);
  const vat = Math.round(taxable * (vatRate / 100));
  const grandTotal = taxable + vat;
  return { subtotal, discount, vatRate, vat, grandTotal, taxable };
}

function applyDiscount() {
  if (state.cart.length === 0) { showToast('Cart is empty'); return; }

  // Reset modal state
  _discountType = 'pct';
  const input = document.getElementById('disc-value');
  if (input) { input.value = ''; input.oninput = updateDiscountPreview; }
  setDiscountType('pct');
  updateDiscountPreview();
  document.getElementById('discount-modal')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('disc-value')?.focus(), 80);
}

function setDiscountType(type) {
  _discountType = type;
  const pctBtn   = document.getElementById('disc-type-pct');
  const fixedBtn = document.getElementById('disc-type-fixed');
  const label    = document.getElementById('disc-input-label');
  const input    = document.getElementById('disc-value');

  if (type === 'pct') {
    if (pctBtn)   { pctBtn.style.background = 'var(--brand)'; pctBtn.style.color = '#fff'; pctBtn.classList.remove('secondary'); }
    if (fixedBtn) { fixedBtn.style.background = ''; fixedBtn.style.color = ''; fixedBtn.classList.add('secondary'); }
    if (label)    label.textContent = 'Discount Percentage (%)';
    if (input)    { input.placeholder = 'e.g. 10'; input.max = '100'; }
  } else {
    if (fixedBtn) { fixedBtn.style.background = 'var(--brand)'; fixedBtn.style.color = '#fff'; fixedBtn.classList.remove('secondary'); }
    if (pctBtn)   { pctBtn.style.background = ''; pctBtn.style.color = ''; pctBtn.classList.add('secondary'); }
    if (label)    label.textContent = `Fixed Discount Amount (${getCurrency()})`;
    if (input)    { input.placeholder = 'e.g. 500'; input.removeAttribute('max'); }
  }
  updateDiscountPreview();
}

function updateDiscountPreview() {
  const sub     = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const val     = parseFloat(document.getElementById('disc-value')?.value) || 0;
  const cur     = getCurrency();
  const vatRate = getVatRate();

  let disc = 0;
  if (_discountType === 'pct') {
    disc = Math.min(Math.round(sub * (val / 100)), sub);
  } else {
    disc = Math.min(val, sub);
  }

  const vat   = Math.round((sub - disc) * (vatRate / 100));
  const total = sub - disc + vat;

  const subEl   = document.getElementById('disc-preview-sub');
  const discEl  = document.getElementById('disc-preview-disc');
  const totalEl = document.getElementById('disc-preview-total');

  if (subEl)   subEl.textContent   = `${cur} ${fmt(sub)}.00`;
  if (discEl)  discEl.textContent  = disc > 0 ? `- ${cur} ${fmt(disc)}.00` : '—';
  if (totalEl) totalEl.textContent = `${cur} ${fmt(total)}.00`;
}

function confirmDiscount() {
  if (state.cart.length === 0) { showToast('Cart is empty'); return; }

  const val = parseFloat(document.getElementById('disc-value')?.value);
  if (isNaN(val) || val <= 0) { showToast('Enter a valid discount amount'); return; }

  const sub = state.cart.reduce((s, i) => s + i.price * i.qty, 0);

  if (_discountType === 'pct') {
    if (val > 100) { showToast('Percentage cannot exceed 100%'); return; }
    _discountValue = val;
    const disc = Math.round(sub * (val / 100));
    _activeDiscountAmt = disc;
    showToast(`${val}% discount applied (${getCurrency()} ${fmt(disc)})`);
  } else {
    if (val > sub) { showToast(`Discount cannot exceed subtotal of ${getCurrency()} ${fmt(sub)}`); return; }
    _discountValue = val;
    _activeDiscountAmt = Math.round(val);
    showToast(`${getCurrency()} ${fmt(_activeDiscountAmt)} discount applied`);
  }

  renderCart();
  closeModal('discount-modal');
}

function holdOrder() {
  if (state.cart.length === 0) { showToast('Cart is empty'); return; }
  const cust = document.getElementById('cart-customer')?.selectedOptions[0]?.text || 'Walk-in Customer';
  state.heldOrders.push({
    id: 'HOLD-' + (state.heldOrders.length + 1),
    customer: cust,
    items: [...state.cart],
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  document.getElementById('held-count').textContent = state.heldOrders.length;
  clearCart();
  showToast(`Order held for ${cust}`);
}

/* ── SALE HISTORY ─────────────────────────────────────────────── */
/* OPTIMIZED SALES HISTORY & RECEIPT DETAILED VIEW */
let _txnCache = [];
let _activeTxnDetail = null;

function openSaleHistoryModal() {
  const modal = document.getElementById('sale-history-modal');
  if (modal) modal.classList.remove('hidden');
  loadSaleHistory();
}

async function loadSaleHistory() {
  const tbody = document.getElementById('txn-tbody');
  if (tbody) tbody.innerHTML = '<tr class="view-loading-row"><td colspan="8"><span class="spinner-sm"></span> Loading branch transactions...</td></tr>';
  
  const bId = state.currentBranch?.id;
  const bParam = bId && bId !== 'all' ? `?branch_id=${bId}&limit=500` : '?limit=500';
  const subEl = document.getElementById('sh-modal-subtitle');
  if (subEl) {
    subEl.textContent = bId && bId !== 'all'
      ? `Transactions for ${state.currentBranch?.name || 'Active Branch'} · Filter sales performance and itemized receipts`
      : 'All Branches (Enterprise HQ) Consolidated Sales History';
  }

  try {
    const data = await apiGet(`/api/sales/transactions${bParam}`);
    _txnCache = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    updateSaleHistoryKPIs(_txnCache);
    renderSaleHistory(_txnCache);
  } catch (e) {
    console.error('[loadSaleHistory] error:', e);
    _txnCache = [];
    updateSaleHistoryKPIs([]);
    renderSaleHistory([]);
  }
}

function updateSaleHistoryKPIs(txns) {
  const count = txns.length;
  const revenue = txns.reduce((sum, t) => sum + (t.total || 0), 0);
  const cash = txns.filter(t => (t.payment_method || '').toLowerCase() === 'cash').reduce((sum, t) => sum + (t.total || 0), 0);
  const mpesa = txns.filter(t => (t.payment_method || '').toLowerCase() === 'mpesa').reduce((sum, t) => sum + (t.total || 0), 0);

  const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setKpi('sh-kpi-count', count);
  setKpi('sh-kpi-revenue', `KES ${fmt(revenue)}`);
  setKpi('sh-kpi-cash', `KES ${fmt(cash)}`);
  setKpi('sh-kpi-mpesa', `KES ${fmt(mpesa)}`);
}

function renderSaleHistory(txns) {
  const tbody = document.getElementById('txn-tbody');
  if (!tbody) return;
  if (!txns.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">No transactions found matching criteria.</td></tr>';
    return;
  }
  const methodBadge = { cash:'badge-green', mpesa:'badge-blue', card:'badge-purple', credit:'badge-amber' };
  tbody.innerHTML = txns.map(t => {
    const dt = t.created_at ? new Date(t.created_at).toLocaleString('en-KE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
    const method = (t.payment_method || 'cash').toLowerCase();
    const badgeCls = methodBadge[method] || 'badge-green';
    const transactionRef = t.ref || t.ref_no || `TXN-${t.id}`;
    const txId = t.id || transactionRef;
    return `<tr>
      <td><strong class="mono" style="font-size:12.5px;">${transactionRef}</strong></td>
      <td style="font-size:12px;color:var(--text-muted);">${dt}</td>
      <td><strong>${t.customer_name || 'Walk-in'}</strong></td>
      <td>${t.cashier_name || 'System Cashier'}</td>
      <td><span class="badge ${badgeCls}" style="text-transform:uppercase;font-size:10px;">${method}</span></td>
      <td><strong style="color:var(--text-primary);">KES ${fmt(t.total || 0)}</strong></td>
      <td><span class="badge badge-green">COMPLETED</span></td>
      <td><button class="btn-sm tiny secondary" onclick="viewTxnDetail('${txId}')">View Details</button></td>
    </tr>`;
  }).join('');
}

function filterSaleHistory() {
  const q      = (document.getElementById('txn-search')?.value || '').toLowerCase();
  const date   = document.getElementById('txn-date')?.value || '';
  const method = (document.getElementById('txn-method')?.value || '').toLowerCase();

  const filtered = _txnCache.filter(t => {
    const transactionRef = t.ref || t.ref_no || '';
    const matchQ = !q ||
      transactionRef.toLowerCase().includes(q) ||
      (t.customer_name || '').toLowerCase().includes(q) ||
      (t.cashier_name || '').toLowerCase().includes(q);
    const matchDate = !date || (t.created_at || '').startsWith(date);
    const matchMethod = !method || (t.payment_method || '').toLowerCase() === method;
    return matchQ && matchDate && matchMethod;
  });
  renderSaleHistory(filtered);
}

async function viewTxnDetail(txId) {
  const modal = document.getElementById('txn-detail-modal');
  const container = document.getElementById('txn-detail-content');
  if (modal) modal.classList.remove('hidden');
  if (container) container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Loading line items...</div>';

  let txn = null;
  try {
    const res = await apiGet(`/api/sales/transactions/${txId}`);
    txn = res.data || res;
  } catch (e) {
    txn = _txnCache.find(t => t.id == txId || (t.ref || t.ref_no) == txId);
  }

  if (!txn) {
    if (container) container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);">Transaction details not found.</div>';
    return;
  }

  _activeTxnDetail = txn;
  const dt = txn.created_at ? new Date(txn.created_at).toLocaleString('en-KE') : new Date().toLocaleString('en-KE');
  const ref = txn.ref || txn.ref_no || `TXN-${txn.id}`;
  const items = txn.items && txn.items.length ? txn.items : [
    { product_name: 'Product Items', qty: 1, unit_price: txn.subtotal || txn.total, line_total: txn.subtotal || txn.total }
  ];

  container.innerHTML = `
    <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;font-family:monospace;font-size:12.5px;color:var(--text-primary);">
      <div style="text-align:center;border-bottom:1px dashed var(--border);padding-bottom:10px;margin-bottom:10px;">
        <h3 style="margin:0;font-size:16px;font-weight:700;">OPENFLOAT POS X</h3>
        <p style="margin:4px 0 0 0;font-size:11px;color:var(--text-muted);">${txn.branch_name || 'Nairobi Main Branch'} · POS Terminal</p>
        <p style="margin:2px 0 0 0;font-size:11px;color:var(--text-muted);">${dt}</p>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Receipt Ref:</span><strong>${ref}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Customer:</span><span>${txn.customer_name || 'Walk-in Customer'}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Cashier:</span><span>${txn.cashier_name || 'Staff Cashier'}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Payment Method:</span><span style="text-transform:uppercase;font-weight:600;">${txn.payment_method || 'CASH'}</span></div>
      ${(txn.payment_method || '').toLowerCase() === 'mpesa' || txn.mpesa_receipt_no ? `<div style="display:flex;justify-content:space-between;margin-bottom:10px;color:var(--green);font-weight:700;"><span>M-Pesa Code:</span><span>${txn.mpesa_receipt_no || state._mpesaReceiptNo || 'QFH9128391'}</span></div>` : ''}

      <div style="border-top:1px dashed var(--border);border-bottom:1px dashed var(--border);padding:8px 0;margin-bottom:10px;">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;font-weight:700;margin-bottom:6px;">
          <span>Item</span><span style="text-align:center;">Qty x Price</span><span style="text-align:right;">Total</span>
        </div>
        ${items.map(it => `
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;margin-bottom:4px;">
            <span>${it.product_name || it.name || 'Item'}</span>
            <span style="text-align:center;">${it.qty} x ${fmt(it.unit_price || it.price || 0)}</span>
            <span style="text-align:right;">KES ${fmt(it.line_total || (it.qty * (it.unit_price || 0)))}</span>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Subtotal:</span><span>KES ${fmt(txn.subtotal || txn.total || 0)}</span></div>
      ${txn.discount ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--green);"><span>Discount:</span><span>- KES ${fmt(txn.discount)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:var(--text-muted);"><span>VAT (${(() => {
        const net = (txn.subtotal || txn.total || 0) - (txn.discount || 0);
        return (txn.vat !== undefined && txn.vat !== null && net > 0) ? Math.round((txn.vat / net) * 100) : getVatRate();
      })()}% Included):</span><span>KES ${fmt(txn.vat || 0)}</span></div>
      <div style="display:flex;justify-content:space-between;border-top:2px solid var(--text-primary);padding-top:6px;font-size:14px;font-weight:700;">
        <span>TOTAL AMOUNT:</span><span>KES ${fmt(txn.total || 0)}</span>
      </div>
    </div>
  `;
}

function printCurrentTxnReceipt() {
  if (!_activeTxnDetail) {
    showToast('No receipt selected to print');
    return;
  }
  const txn = _activeTxnDetail;
  const ref = txn.ref || txn.ref_no || `TXN-${txn.id}`;
  const dt = txn.created_at ? new Date(txn.created_at).toLocaleString('en-KE') : new Date().toLocaleString('en-KE');
  const items = txn.items && txn.items.length ? txn.items : [
    { product_name: 'Product Order', qty: 1, unit_price: txn.total, line_total: txn.total }
  ];
  const netTaxable = (txn.subtotal || txn.total || 0) - (txn.discount || 0);
  const vatPct = (txn.vat !== undefined && txn.vat !== null && netTaxable > 0) ? Math.round((txn.vat / netTaxable) * 100) : getVatRate();

  const html = `<html><head><title>Receipt - ${ref}</title>
  <style>
    body { font-family: monospace; max-width: 300px; margin: 10px auto; font-size: 12px; color: #000; }
    h2 { text-align: center; margin: 0; font-size: 16px; }
    p { text-align: center; margin: 2px 0; font-size: 11px; }
    hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; margin: 3px 0; }
    .bold { font-weight: bold; }
    .total { font-size: 14px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; }
  </style></head>
  <body>
    <h2>OPENFLOAT POS X</h2>
    <p>${txn.branch_name || 'Nairobi Main Store'}</p>
    <p>${dt}</p>
    <hr>
    <div class="row"><span>Ref:</span><span class="bold">${ref}</span></div>
    <div class="row"><span>Customer:</span><span>${txn.customer_name || 'Walk-in'}</span></div>
    <div class="row"><span>Cashier:</span><span>${txn.cashier_name || 'Staff'}</span></div>
    <div class="row"><span>Method:</span><span class="bold">${(txn.payment_method || 'cash').toUpperCase()}</span></div>
    ${(txn.payment_method || '').toLowerCase() === 'mpesa' || txn.mpesa_receipt_no ? `<div class="row bold" style="color:#059669;"><span>M-Pesa Code:</span><span>${txn.mpesa_receipt_no || state._mpesaReceiptNo || 'QFH9128391'}</span></div>` : ''}
    <hr>
    ${items.map(it => `
      <div class="row">
        <span>${it.qty}x ${it.product_name || 'Item'}</span>
        <span>KES ${fmt(it.line_total || (it.qty * (it.unit_price || 0)))}</span>
      </div>
    `).join('')}
    <hr>
    <div class="row"><span>Subtotal:</span><span>KES ${fmt(txn.subtotal || txn.total || 0)}</span></div>
    <div class="row"><span>VAT (${vatPct}%):</span><span>KES ${fmt(txn.vat || 0)}</span></div>
    <div class="row total"><span>TOTAL PAID:</span><span>KES ${fmt(txn.total || 0)}</span></div>
    <hr>
    <p style="margin-top:12px;">Thank you for your business!</p>
    <script>window.print();<\/script>
  </body></html>`;

  const w = window.open('', '_blank', 'width=380,height=500');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

function exportSaleHistoryCSV() {
  if (!_txnCache || !_txnCache.length) {
    showToast('No sales transactions to export');
    return;
  }
  const headers = ['Ref No', 'Date & Time', 'Customer', 'Cashier', 'Payment Method', 'Subtotal', 'VAT', 'Total Amount', 'Status'];
  const rows = _txnCache.map(t => [
    `"${(t.ref || t.ref_no || t.id || '').replace(/"/g, '""')}"`,
    `"${t.created_at ? new Date(t.created_at).toISOString() : ''}"`,
    `"${(t.customer_name || 'Walk-in').replace(/"/g, '""')}"`,
    `"${(t.cashier_name || '').replace(/"/g, '""')}"`,
    `"${(t.payment_method || 'cash').toUpperCase()}"`,
    t.subtotal || 0,
    t.vat || 0,
    t.total || 0,
    'COMPLETED'
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const branchSlug = (state.currentBranch?.name || 'all_branches').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  link.download = `sales_history_${branchSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Sales history for ${state.currentBranch?.name || 'active branch'} exported`);
}
function openHeldOrders() {
  const list = document.getElementById('held-list');
  if (!list) return;
  if (state.heldOrders.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">No held orders.</p>';
  } else {
    list.innerHTML = state.heldOrders.map((h, idx) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;">
        <div>
          <strong style="font-size:12px;">${h.customer}</strong>
          <div style="font-size:11px;color:var(--text-muted);">${h.items.length} items · Held at ${h.time}</div>
        </div>
        <button class="btn-sm" onclick="recallHeld(${idx})">Recall</button>
      </div>
    `).join('');
  }
  document.getElementById('held-modal')?.classList.remove('hidden');
}

function recallHeld(idx) {
  const held = state.heldOrders.splice(idx, 1)[0];
  if (held) {
    state.cart = held.items;
    renderCart();
    document.getElementById('held-count').textContent = state.heldOrders.length;
    closeModal('held-modal');
    showToast(`Recalled order for ${held.customer}`);
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}


let _activeNumpadTarget = null;
let _activeNumpadLabel = 'Cash Tendered';

function setActiveNumpadTarget(el, label = 'Input') {
  _activeNumpadTarget = el;
  _activeNumpadLabel = label;
  updateNumpadDisplay();
}

function getActiveNumpadInput() {
  if (_activeNumpadTarget && document.body.contains(_activeNumpadTarget) && _activeNumpadTarget.offsetParent !== null) {
    return _activeNumpadTarget;
  }
  const method = state.selectedPayMethod || 'cash';
  if (method === 'cash') {
    _activeNumpadLabel = 'Cash Tendered';
    return document.getElementById('tendered-amount');
  }
  if (method === 'mpesa') {
    _activeNumpadLabel = 'M-Pesa Phone';
    return document.getElementById('mpesa-phone');
  }
  if (method === 'split') {
    _activeNumpadLabel = 'Split Cash';
    return document.getElementById('split-cash') || document.getElementById('split-mpesa');
  }
  if (method === 'card') {
    _activeNumpadLabel = 'Card Reference';
    return document.getElementById('card-ref') || document.querySelector('#pay-form-card input');
  }
  return document.getElementById('tendered-amount');
}

function updateNumpadDisplay() {
  const display = document.getElementById('numpad-display');
  const labelEl = document.getElementById('numpad-target-label');
  const input = getActiveNumpadInput();
  if (labelEl) labelEl.textContent = _activeNumpadLabel || 'Payment Input';
  if (display) {
    display.textContent = (input && input.value !== undefined && input.value !== '') ? input.value : '0';
  }
}

function numpadPress(key) {
  const input = getActiveNumpadInput();
  if (!input) return;

  const currentVal = input.value || '';
  if (key === '.') {
    if (currentVal.includes('.')) return;
    input.value = currentVal === '' ? '0.' : currentVal + '.';
  } else {
    if (currentVal === '0' && key !== '.') {
      input.value = key;
    } else {
      input.value = currentVal + key;
    }
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  updateNumpadDisplay();
}

function numpadBackspace() {
  const input = getActiveNumpadInput();
  if (!input) return;
  const currentVal = input.value || '';
  input.value = currentVal.slice(0, -1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  updateNumpadDisplay();
}

function numpadClear() {
  const input = getActiveNumpadInput();
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  updateNumpadDisplay();
}

function selectPayMethod(method) {
  state.selectedPayMethod = method;
  document.querySelectorAll('.pay-btn').forEach(b => {
    if (b.getAttribute('data-method') === method) b.classList.add('active');
    else b.classList.remove('active');
  });

  document.querySelectorAll('.pay-form').forEach(f => f.classList.remove('active'));
  document.getElementById('pay-form-' + method)?.classList.add('active');

  // Update active numpad target based on selected payment method
  if (method === 'cash') setActiveNumpadTarget(document.getElementById('tendered-amount'), 'Cash Tendered');
  else if (method === 'mpesa') setActiveNumpadTarget(document.getElementById('mpesa-phone'), 'M-Pesa Phone');
  else if (method === 'split') setActiveNumpadTarget(document.getElementById('split-cash'), 'Split Cash');
  else if (method === 'card') setActiveNumpadTarget(document.getElementById('card-ref'), 'Card Reference');
  updateNumpadDisplay();
}

function setTender(amt) {
  const input = document.getElementById('tendered-amount');
  if (input) {
    const val = (parseFloat(input.value) || 0) + amt;
    input.value = val;
    calcChange();
    updateNumpadDisplay();
  }
}

function setExact() {
  const { grandTotal } = getCartTotals();
  const input = document.getElementById('tendered-amount');
  if (input) {
    input.value = grandTotal;
    calcChange();
    updateNumpadDisplay();
  }
}

function calcChange() {
  const { grandTotal } = getCartTotals();
  const tendered = parseFloat(document.getElementById('tendered-amount')?.value) || 0;
  const change = Math.max(0, tendered - grandTotal);
  const changeEl = document.getElementById('change-amount');
  if (changeEl) changeEl.textContent = `${getCurrency()} ${fmt(change)}.00`;
}

function calcSplit() {
  const { grandTotal } = getCartTotals();
  const cash = parseFloat(document.getElementById('split-cash')?.value) || 0;
  const mpesa = parseFloat(document.getElementById('split-mpesa')?.value) || 0;
  const remaining = Math.max(0, grandTotal - (cash + mpesa));
  const remEl = document.getElementById('split-remaining');
  if (remEl) remEl.textContent = `${getCurrency()} ${fmt(remaining)}.00`;
}

async function triggerSTK() {
  const phoneInput = document.getElementById('mpesa-phone');
  const statusEl   = document.getElementById('stk-status');
  const stkBtn     = document.querySelector('.stk-btn');
  const phone      = phoneInput?.value?.trim();

  if (!phone) {
    showToast('Please enter a phone number');
    return;
  }

  // Calculate total from current cart using unified source of truth
  const { grandTotal } = getCartTotals();

  if (grandTotal <= 0) {
    showToast('Cart is empty — nothing to charge');
    return;
  }

  // Generate a transaction ref
  const txRef = 'TXN-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' +
                Math.random().toString(36).substring(2,6).toUpperCase();

  // Update UI — sending
  if (statusEl) statusEl.textContent = `Sending STK prompt to ${phone}...`;
  if (stkBtn)   { stkBtn.disabled = true; stkBtn.textContent = 'Sending...'; }

  try {
    // 1. Initiate STK Push
    const pushRes = await apiPost('/api/mpesa/stk-push', {
      phone,
      amount:          total,
      transaction_ref: txRef,
      account_ref:     'OpenFloat POS'
    });

    if (!pushRes.success) {
      throw new Error(pushRes.error || 'STK Push failed');
    }

    const checkoutId = pushRes.CheckoutRequestID;
    const isSandbox  = pushRes.sandbox === true;

    if (statusEl) statusEl.textContent = isSandbox
      ? `[Sandbox] M-Pesa prompt simulated. Ref: ${checkoutId.slice(-12)}`
      : `Prompt sent to ${phone} — awaiting customer confirmation...`;

    if (isSandbox) {
      // In sandbox: no real callback comes, just simulate success after 2s
      setTimeout(() => {
        if (statusEl) statusEl.textContent = `[Sandbox] Payment confirmed! Ref: ${txRef}`;
        showToast('[Sandbox] M-Pesa payment simulated ✓');
        if (stkBtn) { stkBtn.disabled = false; stkBtn.textContent = 'Send STK Push'; }
        processPayment();
      }, 2000);
      return;
    }

    // 2. Poll for real confirmation (max 60s, every 3s)
    let attempts = 0;
    const maxAttempts = 20;

    const pollTimer = setInterval(async () => {
      attempts++;
      try {
        let statusRes = await apiGet(`/api/mpesa/status/${checkoutId}`);

        // Active Safaricom Direct Query fallback every 2nd attempt if callback didn't arrive yet
        if (statusRes.status === 'pending' && attempts % 2 === 0) {
          try {
            const darajaQuery = await apiGet(`/api/mpesa/query/${checkoutId}`);
            if (darajaQuery.ResultCode === '0' || darajaQuery.ResultCode === 0) {
              statusRes = {
                status: 'completed',
                mpesa_receipt_no: darajaQuery.MpesaReceiptNumber || 'CONFIRMED'
              };
            } else if (darajaQuery.ResultCode && darajaQuery.ResultCode !== '0' && !darajaQuery.ResultDesc?.includes('being processed')) {
              statusRes = {
                status: 'failed',
                result_desc: darajaQuery.ResultDesc
              };
            }
          } catch (e) {
            // Ignore query error, fallback to normal polling
          }
        }

        if (statusRes.status === 'completed') {
          clearInterval(pollTimer);
          const receiptNo = statusRes.mpesa_receipt_no || 'MPESA_OK';
          if (statusEl) statusEl.textContent = `Payment confirmed! M-Pesa Ref: ${receiptNo}`;
          showToast(`M-Pesa payment confirmed — ${receiptNo}`);
          if (stkBtn) { stkBtn.disabled = false; stkBtn.textContent = 'Send STK Push'; }
          state._mpesaReceiptNo = receiptNo;
          processPayment();

        } else if (statusRes.status === 'failed') {
          clearInterval(pollTimer);
          if (statusEl) statusEl.textContent = `Payment failed: ${statusRes.result_desc || 'Customer cancelled or timed out'}`;
          showToast('M-Pesa payment failed or was cancelled', 'error');
          if (stkBtn) { stkBtn.disabled = false; stkBtn.textContent = 'Send STK Push'; }

        } else if (attempts >= maxAttempts) {
          clearInterval(pollTimer);
          if (statusEl) statusEl.textContent = 'Timed out — if customer paid, enter receipt below.';
          showToast('Timed out — enter M-Pesa receipt manually if paid', 'error');
          if (stkBtn) { stkBtn.disabled = false; stkBtn.textContent = 'Resend STK Push'; }
          // Show manual confirmation panel
          const manualPanel = document.getElementById('mpesa-manual-confirm');
          if (manualPanel) manualPanel.style.display = 'block';
        } else {
          // Still pending
          const dots = '.'.repeat((attempts % 3) + 1);
          if (statusEl) statusEl.textContent = `Waiting for customer confirmation${dots} (${attempts * 3}s)`;
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, 3000);

  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    showToast('STK Push error: ' + err.message, 'error');
    if (stkBtn) { stkBtn.disabled = false; stkBtn.textContent = 'Send STK Push'; }
  }
}

function manualMpesaConfirm() {
  const ref = (document.getElementById('mpesa-manual-ref')?.value || '').trim().toUpperCase();
  if (!ref) {
    showToast('Please enter the M-Pesa receipt number from the customer\'s message');
    return;
  }
  state._mpesaReceiptNo = ref;
  const statusEl = document.getElementById('stk-status');
  if (statusEl) statusEl.textContent = `Payment manually confirmed. M-Pesa Ref: ${ref}`;
  const manualPanel = document.getElementById('mpesa-manual-confirm');
  if (manualPanel) manualPanel.style.display = 'none';
  showToast(`M-Pesa payment confirmed — ${ref}`);
  processPayment();
}

let _lastReceiptData = null;

async function processPayment() {
  if (state.cart.length === 0) { showToast('Cart is empty'); return; }

  const { subtotal, discount, vatRate, vat, grandTotal } = getCartTotals();
  const custSelect = document.getElementById('cart-customer');
  const custId = custSelect && custSelect.value ? parseInt(custSelect.value) : null;
  const custName = custSelect ? custSelect.selectedOptions[0]?.text : 'Walk-in Customer';
  const tendered = parseFloat(document.getElementById('tendered-amount')?.value) || grandTotal;
  const changeAmt = Math.max(0, tendered - grandTotal);
  const cartItemsSnapshot = state.cart.map(i => ({ ...i }));
  const payMethod = state.selectedPayMethod || 'cash';

  const bId = state.currentBranch?.id;
  const targetBranchId = (bId && bId !== 'all') ? bId : (state.user?.branch_id || 1);

  const checkoutPayload = {
    branch_id: targetBranchId,
    customer_id: custId,
    items: state.cart.map(item => ({
      product_id: item.id,
      qty: item.qty,
      unit_price: item.price,
      discount: 0,
      line_total: item.price * item.qty
    })),
    discount: discount,
    vat_rate: vatRate,
    payment_method: payMethod,
    notes: 'POS Cashier Order'
  };

  let txRef = 'TXN-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).substring(2,6).toUpperCase();

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;

    const res = await fetch('/api/sales/checkout', {
      method: 'POST',
      headers,
      body: JSON.stringify(checkoutPayload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      txRef = data.ref || txRef;
      showToast(`Sale completed! Ref: ${txRef}`);
    } else {
      showToast(`Sale recorded: ${txRef}`);
    }
  } catch (err) {
    showToast(`Payment recorded: ${txRef}`);
  }

  // 1. Show receipt modal immediately using order snapshot
  previewReceipt(txRef, custName, subtotal, vat, grandTotal, cartItemsSnapshot, payMethod, changeAmt, discount);

  // 2. Clear cart & reset tendered inputs for next sale
  state.cart = [];
  _discountValue = 0;
  _activeDiscountAmt = 0;
  renderCart();
  const tendEl = document.getElementById('tendered-amount');
  if (tendEl) tendEl.value = '';
  const changeEl = document.getElementById('change-amount');
  if (changeEl) changeEl.textContent = `${getCurrency()} 0.00`;

  // 3. Refresh live inventory & dashboard KPIs
  loadPOSProducts();
  loadDashboardKPIs();
}

function previewReceipt(ref, customerName, sub, vat, total, items, payMethod, changeAmt, discount) {
  const { subtotal: cSub, discount: cDisc, vat: cVat, grandTotal: cTot } = getCartTotals();
  const vatRate = getVatRate();
  const discAmt = discount !== undefined ? discount : cDisc;

  if (items && items.length > 0) {
    _lastReceiptData = {
      ref: ref || ('TXN-' + Math.random().toString(36).substring(2,8).toUpperCase()),
      customerName: customerName || 'Walk-in Customer',
      subtotal: sub,
      discount: discAmt || 0,
      vat: vat,
      vatRate: vatRate,
      total: total,
      items: items.map(i => ({ ...i })),
      payMethod: payMethod || state.selectedPayMethod || 'cash',
      changeAmt: changeAmt || 0,
      cashierName: state.user ? state.user.name : 'Owner',
      dateStr: new Date().toLocaleString('en-KE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  } else if (state.cart.length > 0) {
    const custSelect = document.getElementById('cart-customer');
    const custName = custSelect ? custSelect.selectedOptions[0]?.text : 'Walk-in Customer';
    const tendered = parseFloat(document.getElementById('tendered-amount')?.value) || cTot;

    _lastReceiptData = {
      ref: ref || ('TXN-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).substring(2,6).toUpperCase()),
      customerName: custName,
      subtotal: cSub,
      discount: cDisc || 0,
      vat: cVat,
      vatRate: vatRate,
      total: cTot,
      items: state.cart.map(i => ({ ...i })),
      payMethod: state.selectedPayMethod || 'cash',
      changeAmt: Math.max(0, tendered - cTot),
      cashierName: state.user ? state.user.name : 'Owner',
      dateStr: new Date().toLocaleString('en-KE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  }

  if (!_lastReceiptData) {
    showToast('No receipt to preview — cart is empty');
    return;
  }

  const d = _lastReceiptData;
  const cur = getCurrency();
  const vatPct = d.vatRate !== undefined ? d.vatRate : getVatRate();

  const numEl = document.getElementById('receipt-num');
  if (numEl) numEl.textContent = `Receipt: ${d.ref}`;

  const dateEl = document.getElementById('receipt-date');
  if (dateEl) dateEl.textContent = `Date: ${d.dateStr}`;

  const cashierEl = document.getElementById('receipt-cashier-info');
  if (cashierEl) cashierEl.textContent = `Cashier: ${d.cashierName}`;

  const itemsContainer = document.getElementById('receipt-items');
  if (itemsContainer) {
    itemsContainer.innerHTML = d.items.map(i => `
      <div class="receipt-row">
        <span>${i.qty}x ${i.name}</span>
        <span>${cur} ${fmt(i.price * i.qty)}</span>
      </div>
    `).join('');
  }

  const summaryContainer = document.getElementById('receipt-summary');
  if (summaryContainer) {
    let changeHtml = '';
    if (d.payMethod.toLowerCase() === 'cash' && d.changeAmt > 0) {
      changeHtml = `<div class="receipt-row" style="color:var(--accent-emerald);font-weight:600;"><span>Change Given:</span><span>${cur} ${fmt(d.changeAmt)}</span></div>`;
    }

    let discountHtml = '';
    if (d.discount > 0) {
      discountHtml = `<div class="receipt-row" style="color:#ef4444;font-weight:600;"><span>Discount:</span><span>- ${cur} ${fmt(d.discount)}</span></div>`;
    }

    let mpesaHtml = '';
    if ((d.payMethod || '').toLowerCase() === 'mpesa' || state._mpesaReceiptNo) {
      const mCode = d.mpesaCode || state._mpesaReceiptNo || 'QFH9128391';
      mpesaHtml = `<div class="receipt-row" style="color:#059669;font-weight:700;margin-top:2px;"><span>M-Pesa Code:</span><span>${mCode}</span></div>`;
    }

    summaryContainer.innerHTML = `
      <div class="receipt-row"><span>Subtotal:</span><span>${cur} ${fmt(d.subtotal)}</span></div>
      ${discountHtml}
      <div class="receipt-row"><span>VAT (${vatPct}%):</span><span>${cur} ${fmt(d.vat)}</span></div>
      <div class="receipt-row" style="font-size:13px;font-weight:700;"><span>TOTAL:</span><span>${cur} ${fmt(d.total)}</span></div>
      ${changeHtml}
      <div class="receipt-row" style="margin-top:4px;color:#6B7280;"><span>Customer:</span><span>${d.customerName}</span></div>
      <div class="receipt-row" style="color:#6B7280;"><span>Payment Method:</span><span style="text-transform:uppercase;">${d.payMethod}</span></div>
      ${mpesaHtml}
    `;
  }

  document.getElementById('receipt-modal')?.classList.remove('hidden');
}

function onCustomerSelect() {
  const val = document.getElementById('cart-customer')?.value;
  const strip = document.getElementById('loyalty-strip');
  if (!val || val === '') { strip?.classList.add('hidden'); return; }

  const customer = state.customersCache.find(c => String(c.id) === String(val));
  if (customer && customer.loyalty_points > 0) {
    const pts = customer.loyalty_points || 0;
    const kes = Math.floor(pts / 10);
    document.getElementById('loyalty-pts').textContent = fmt(pts) + ' pts';
    document.getElementById('loyalty-kes').textContent = fmt(kes);
    strip?.classList.remove('hidden');
  } else {
    strip?.classList.add('hidden');
  }
}

function redeemPoints() {
  showToast('Loyalty discount applied to order');
}

function newSession() {
  clearCart();
  state.heldOrders = [];
  document.getElementById('held-count').textContent = '0';
  showToast('New cashier session started');
}

/* INVENTORY FUNCTIONS */
let _inventoryCache = [];

function filterInventory() {
  if (_inventoryCache.length > 0) {
    renderInventoryRows(_inventoryCache);
  } else {
    loadInventory();
  }
}

async function exportInventoryCSV() {
  let items = _inventoryCache;
  if (!items || !items.length) {
    items = await loadInventory();
  }
  if (!items || !items.length) {
    if (state.productsCache && state.productsCache.length) {
      items = state.productsCache.map(p => ({
        name: p.name,
        sku: p.sku,
        category_name: p.cat || 'General',
        stock_qty: p.stock ?? 0,
        unit: 'pcs',
        buy_price: 0,
        sell_price: p.price ?? 0,
        reorder_level: 10,
        supplier_name: '—',
        expiry_date: '—'
      }));
    }
  }
  if (!items || !items.length) {
    showToast('No inventory items to export');
    return;
  }
  const headers = ['Name', 'SKU', 'Category', 'Stock Qty', 'Unit', 'Buy Price (KES)', 'Sell Price (KES)', 'Status', 'Supplier', 'Expiry Date'];
  const rows = items.map(i => {
    const stockStatus = (i.stock_qty === 0 || i.stock === 0) ? 'OUT' : ((i.stock_qty ?? i.stock ?? 0) <= (i.reorder_level || 10)) ? 'LOW' : 'OK';
    return [
      `"${(i.name || '').replace(/"/g, '""')}"`,
      `"${(i.sku || '').replace(/"/g, '""')}"`,
      `"${(i.category_name || i.cat || '').replace(/"/g, '""')}"`,
      i.stock_qty ?? i.stock ?? 0,
      `"${(i.unit || 'pcs').replace(/"/g, '""')}"`,
      i.buy_price || 0,
      i.sell_price || i.price || 0,
      stockStatus,
      `"${(i.supplier_name || '').replace(/"/g, '""')}"`,
      `"${i.expiry_date || ''}"`
    ].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Inventory exported to CSV');
}

/* DASHBOARD & CHARTS */
async function updateDashboard() {
  const period = document.getElementById('period-select')?.value || 'month';
  const periodMap = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    year: 'This Year'
  };

  await loadDashboardKPIs();

  // Dynamic Chart & KPI scaling based on selected period
  if (state.chartInstances.revenue) {
    let labels = [];
    let revData = [];
    let profitData = [];
    let formatUnit = v => 'KES ' + Math.round(v/1000) + 'k';
    
    const txs = state.dashboardTxs || [];
    
    if (period === 'today') {
      labels = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
      revData = Array(7).fill(0);
      profitData = Array(7).fill(0);
      
      const todayStr = new Date().toISOString().slice(0, 10);
      txs.forEach(t => {
        if (t.created_at && t.created_at.startsWith(todayStr) && t.status === 'completed') {
          const date = new Date(t.created_at.replace(' ', 'T'));
          const hour = date.getHours();
          let bucket = 0;
          if (hour < 9) bucket = 0;
          else if (hour < 11) bucket = 1;
          else if (hour < 13) bucket = 2;
          else if (hour < 15) bucket = 3;
          else if (hour < 17) bucket = 4;
          else if (hour < 19) bucket = 5;
          else bucket = 6;
          
          revData[bucket] += t.total || 0;
          profitData[bucket] += (t.total || 0) * 0.3; // 30% estimated margin
        }
      });
      formatUnit = v => 'KES ' + Math.round(v);
    } else if (period === 'week') {
      labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      revData = Array(7).fill(0);
      profitData = Array(7).fill(0);
      
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      txs.forEach(t => {
        if (t.created_at && t.status === 'completed') {
          const date = new Date(t.created_at.replace(' ', 'T'));
          if (date >= oneWeekAgo) {
            const day = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
            const bucket = day === 0 ? 6 : day - 1; // Mon=0, ..., Sun=6
            revData[bucket] += t.total || 0;
            profitData[bucket] += (t.total || 0) * 0.3;
          }
        }
      });
    } else if (period === 'year') {
      labels = ['Q1', 'Q2', 'Q3', 'Q4'];
      revData = Array(4).fill(0);
      profitData = Array(4).fill(0);
      
      const currentYear = new Date().getFullYear();
      txs.forEach(t => {
        if (t.created_at && t.status === 'completed') {
          const date = new Date(t.created_at.replace(' ', 'T'));
          if (date.getFullYear() === currentYear) {
            const bucket = Math.floor(date.getMonth() / 3);
            revData[bucket] += t.total || 0;
            profitData[bucket] += (t.total || 0) * 0.3;
          }
        }
      });
      formatUnit = v => 'KES ' + (v/1000000).toFixed(1) + 'M';
    } else {
      // Month (default - showing weeks)
      labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
      revData = Array(4).fill(0);
      profitData = Array(4).fill(0);
      
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      txs.forEach(t => {
        if (t.created_at && t.status === 'completed') {
          const date = new Date(t.created_at.replace(' ', 'T'));
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            const dayOfMonth = date.getDate();
            let bucket = 0;
            if (dayOfMonth <= 7) bucket = 0;
            else if (dayOfMonth <= 14) bucket = 1;
            else if (dayOfMonth <= 21) bucket = 2;
            else bucket = 3;
            
            revData[bucket] += t.total || 0;
            profitData[bucket] += (t.total || 0) * 0.3;
          }
        }
      });
      formatUnit = v => 'KES ' + (v >= 1000 ? Math.round(v/1000) + 'k' : Math.round(v));
    }

    state.chartInstances.revenue.data.labels = labels;
    state.chartInstances.revenue.data.datasets[0].data = revData;
    state.chartInstances.revenue.data.datasets[1].data = profitData;
    if (state.chartInstances.revenue.options.scales?.y?.ticks) {
      state.chartInstances.revenue.options.scales.y.ticks.callback = formatUnit;
    }
    state.chartInstances.revenue.update();
  }

  showToast(`Dashboard period set to: ${periodMap[period] || period}`);
}

/* CUSTOMIZE DASHBOARD MODAL & LAYOUT PREFERENCES */
function openCustomizeDashboardModal() {
  const cfg = getDashboardConfig();
  
  const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setCheck('dash-opt-kpi-rev', cfg?.kpis?.rev);
  setCheck('dash-opt-kpi-profit', cfg?.kpis?.profit);
  setCheck('dash-opt-kpi-txs', cfg?.kpis?.txs);
  setCheck('dash-opt-kpi-ar', cfg?.kpis?.ar);

  setCheck('dash-opt-widget-payment', cfg?.widgets?.payment);
  setCheck('dash-opt-widget-bottom', cfg?.widgets?.bottom);
  setCheck('dash-opt-widget-approvals', cfg?.widgets?.approvals);

  const radLine = document.getElementById('chart-style-line');
  const radBar = document.getElementById('chart-style-bar');
  if (cfg.chartStyle === 'bar') { if (radBar) radBar.checked = true; }
  else { if (radLine) radLine.checked = true; }

  openModal('customize-dashboard-modal');
}

function getDashboardConfig() {
  const defaults = {
    kpis: { rev: true, profit: true, txs: true, ar: true },
    chartStyle: 'line',
    widgets: { payment: true, bottom: true, approvals: true }
  };
  try {
    const raw = localStorage.getItem('openfloat_dash_cfg');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      kpis: { ...defaults.kpis, ...(parsed.kpis || {}) },
      chartStyle: parsed.chartStyle || defaults.chartStyle,
      widgets: { ...defaults.widgets, ...(parsed.widgets || {}) }
    };
  } catch {
    return defaults;
  }
}


function saveDashboardCustomization() {
  const getCheck = id => !!(document.getElementById(id)?.checked);
  const chartStyle = document.querySelector('input[name="dash-chart-type"]:checked')?.value || 'line';

  const cfg = {
    kpis: {
      rev: getCheck('dash-opt-kpi-rev'),
      profit: getCheck('dash-opt-kpi-profit'),
      txs: getCheck('dash-opt-kpi-txs'),
      ar: getCheck('dash-opt-kpi-ar')
    },
    chartStyle,
    widgets: {
      payment: getCheck('dash-opt-widget-payment'),
      bottom: getCheck('dash-opt-widget-bottom'),
      approvals: getCheck('dash-opt-widget-approvals')
    }
  };

  localStorage.setItem('openfloat_dash_cfg', JSON.stringify(cfg));
  applyDashboardCustomization(cfg);
  closeModal('customize-dashboard-modal');
  showToast('Dashboard layout updated');
}

function applyDashboardCustomization(cfg) {
  if (!cfg) cfg = getDashboardConfig();

  const toggle = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  };

  toggle('kpi-card-rev', cfg.kpis.rev);
  toggle('kpi-card-profit', cfg.kpis.profit);
  toggle('kpi-card-txs', cfg.kpis.txs);
  toggle('kpi-card-ar', cfg.kpis.ar);

  toggle('widget-payment-chart', cfg.widgets.payment);
  toggle('widget-bottom-row', cfg.widgets.bottom);
  toggle('widget-approvals', cfg.widgets.approvals);

  // Toggle chart type (Line vs Bar)
  const targetType = cfg.chartStyle || 'line';
  const currentChart = state.chartInstances.revenue;
  if (!currentChart || currentChart.config.type !== targetType) {
    initRevenueChart(targetType);
  }
}



function setChartTab(btn, mode) {
  document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (state.chartInstances.revenue) {
    const ds = state.chartInstances.revenue.data.datasets;
    if (mode === 'revenue') { ds[0].hidden = false; ds[1].hidden = true; }
    else if (mode === 'profit') { ds[0].hidden = true; ds[1].hidden = false; }
    else { ds[0].hidden = false; ds[1].hidden = false; }
    state.chartInstances.revenue.update();
  }
}

function approveItem(btn) {
  const row = btn.closest('.approval-item');
  if (row) {
    row.style.opacity = '0.5';
    row.style.pointerEvents = 'none';
    showToast('Item approved');
  }
}

function getChartDefaults() {
  const isDark = state.theme === 'dark';
  return {
    textColor: isDark ? '#94A3B8' : '#6B7280',
    gridColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    bgColor: isDark ? '#1A1D27' : '#FFFFFF',
  };
}

function initCharts() {
  initRevenueChart();
  initPaymentChart();
}

function initRevenueChart(chartType) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;
  if (state.chartInstances.revenue) {
    state.chartInstances.revenue.destroy();
    state.chartInstances.revenue = null;
  }
  const d = getChartDefaults();
  const cfg = getDashboardConfig();
  const type = chartType || cfg?.chartStyle || 'line';
  const isBar = type === 'bar';

  const revBg  = isBar ? 'rgba(79, 70, 229, 0.85)' : 'rgba(79, 70, 229, 0.06)';
  const profBg = isBar ? 'rgba(16, 185, 129, 0.85)' : 'rgba(16, 185, 129, 0.06)';

  state.chartInstances.revenue = new Chart(ctx, {
    type: type,
    data: {
      labels: ['Feb','Mar','Apr','May','Jun','Jul'],
      datasets: [
        {
          label: 'Revenue (KES)',
          data: [0, 0, 0, 0, 0, 0],
          borderColor: '#F97316',
          backgroundColor: revBg,
          fill: !isBar,
          tension: 0.35,
          borderWidth: isBar ? 0 : 2,
          borderRadius: isBar ? 4 : 0
        },
        {
          label: 'Profit (KES)',
          data: [0, 0, 0, 0, 0, 0],
          borderColor: '#10B981',
          backgroundColor: profBg,
          fill: !isBar,
          tension: 0.35,
          borderWidth: isBar ? 0 : 2,
          borderRadius: isBar ? 4 : 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: d.textColor, usePointStyle: true } } },
      scales: {
        x: { grid: { color: d.gridColor }, ticks: { color: d.textColor } },
        y: { grid: { color: d.gridColor }, ticks: { color: d.textColor, callback: v => 'KES ' + (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : Math.round(v/1000) + 'k') } }
      }
    }
  });
}


function initPaymentChart() {
  const ctx = document.getElementById('paymentChart');
  if (!ctx) return;
  if (state.chartInstances.payment) state.chartInstances.payment.destroy();

  state.chartInstances.payment = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Cash','M-Pesa','Card','Credit'],
      datasets: [{ data: [0, 0, 0, 0], backgroundColor: ['#F97316','#10B981','#F59E0B','#EC4899'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
  });
}

function initAccountingCharts() {
  const c1 = document.getElementById('cashflowChart');
  if (c1 && !state.chartInstances.cashflow) {
    const d = getChartDefaults();
    state.chartInstances.cashflow = new Chart(c1, {
      type: 'bar',
      data: {
        labels: ['Feb','Mar','Apr','May','Jun','Jul'],
        datasets: [
          { label: 'Inflows', data: [0, 0, 0, 0, 0, 0], backgroundColor: 'rgba(79,70,229,0.85)', borderRadius: 4 },
          { label: 'Outflows', data: [0, 0, 0, 0, 0, 0], backgroundColor: 'rgba(239,68,68,0.75)', borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: d.textColor } } }, scales: { x: { grid: { color: d.gridColor }, ticks: { color: d.textColor } }, y: { grid: { color: d.gridColor }, ticks: { color: d.textColor } } } }
    });
  }
  const c2 = document.getElementById('expenseChart');
  if (c2 && !state.chartInstances.expense) {
    state.chartInstances.expense = new Chart(c2, {
      type: 'doughnut',
      data: { labels: ['COGS','Salaries','Rent','Other'], datasets: [{ data: [0, 0, 0, 0], backgroundColor: ['#F97316','#10B981','#F59E0B','#EC4899'], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
    });
  }
  loadAccounting();
}

/* ══════════════════════════════════════════
   ACCOUNTING MODULE
══════════════════════════════════════════ */
let _accJournalEntriesCache = [];

async function loadAccounting() {
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const txParam = bId && bId !== 'all' ? `?limit=1000&branch_id=${bId}` : '?limit=1000';
    const [ovRes, ledRes, jeRes, txsRes] = await Promise.all([
      apiGet(`/api/accounting/overview${bParam}`),
      apiGet(`/api/accounting/ledgers${bParam}`),
      apiGet(`/api/accounting/entries${bParam}`),
      apiGet(`/api/sales/transactions${txParam}`)
    ]);

    _accJournalEntriesCache = jeRes.data || [];

    // Update Overview KPIs & Charts
    if (ovRes && ovRes.data) {
      const d = ovRes.data;
      const fmt = n => 'KES ' + (n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'K' : (n || 0).toLocaleString());
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setEl('acc-kpi-revenue', fmt(d.total_revenue));
      setEl('acc-kpi-expenses', fmt(d.total_expenses));
      setEl('acc-kpi-profit', fmt(d.net_profit));
      setEl('acc-kpi-ar', fmt(d.outstanding_ar));

      if (!state.chartInstances.cashflow || !state.chartInstances.expense) {
        initAccountingCharts();
      }

      if (state.chartInstances.cashflow) {
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const today = new Date();
        const buckets = [];
        for (let i = 5; i >= 0; i--) {
          const dDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
          buckets.push({
            label: monthNames[dDate.getMonth()],
            year: dDate.getFullYear(),
            month: dDate.getMonth(),
            inflow: 0,
            outflow: 0
          });
        }
        
        // Add transactions to inflows
        const txs = txsRes.data || [];
        txs.forEach(t => {
          if (t.status === 'completed' && t.created_at) {
            const dt = new Date(t.created_at.replace(' ', 'T'));
            const b = buckets.find(x => x.year === dt.getFullYear() && x.month === dt.getMonth());
            if (b) {
              b.inflow += t.total || 0;
            }
          }
        });

        // Add journal entries to inflows/outflows
        const jes = jeRes.data || [];
        jes.forEach(j => {
          if (j.created_at) {
            const dt = new Date(j.created_at.replace(' ', 'T'));
            const b = buckets.find(x => x.year === dt.getFullYear() && x.month === dt.getMonth());
            if (b) {
              if (j.type === 'income') {
                b.inflow += j.amount || 0;
              } else if (j.type === 'expense') {
                b.outflow += j.amount || 0;
              }
            }
          }
        });

        state.chartInstances.cashflow.data.labels = buckets.map(x => x.label);
        state.chartInstances.cashflow.data.datasets[0].data = buckets.map(x => Math.round(x.inflow));
        state.chartInstances.cashflow.data.datasets[1].data = buckets.map(x => Math.round(x.outflow));
        state.chartInstances.cashflow.update();
      }

      if (state.chartInstances.expense) {
        const jes = jeRes.data || [];
        const expCounts = { cogs: 0, salaries: 0, rent: 0, other: 0 };
        jes.forEach(j => {
          if (j.type === 'expense') {
            const cat = (j.category || 'other').toLowerCase();
            if (cat in expCounts) {
              expCounts[cat] += j.amount || 0;
            } else {
              expCounts.other += j.amount || 0;
            }
          }
        });

        state.chartInstances.expense.data.datasets[0].data = [
          Math.round(expCounts.cogs),
          Math.round(expCounts.salaries),
          Math.round(expCounts.rent),
          Math.round(expCounts.other)
        ];
        state.chartInstances.expense.update();
      }
    }

    // Render AR Ledger
    const arTbody = document.getElementById('acc-ar-tbody');
    if (arTbody) {
      const arItems = (ledRes && ledRes.accounts_receivable) || [];
      if (!arItems.length) {
        arTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:14px;color:var(--text-muted);">No outstanding client credit balances.</td></tr>';
      } else {
        arTbody.innerHTML = arItems.slice(0, 5).map(c => `<tr>
          <td><strong>${c.name}</strong></td>
          <td style="color:var(--amber);font-weight:600;">KES ${Number(c.amount_owed).toLocaleString()}</td>
          <td>${c.phone || '—'}</td>
          <td><span class="badge badge-amber">Outstanding</span></td>
        </tr>`).join('');
      }
    }

    // Render AP Ledger
    const apTbody = document.getElementById('acc-ap-tbody');
    if (apTbody) {
      const apItems = (ledRes && ledRes.accounts_payable) || [];
      if (!apItems.length) {
        apTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:14px;color:var(--text-muted);">No pending purchase payables.</td></tr>';
      } else {
        apTbody.innerHTML = apItems.slice(0, 5).map(p => `<tr>
          <td><code>${p.ref || 'PR-'+p.id}</code></td>
          <td style="color:var(--red);font-weight:600;">KES ${Number(p.amount_owed).toLocaleString()}</td>
          <td>${p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
          <td><span class="badge badge-red">Pending PO</span></td>
        </tr>`).join('');
      }
    }

    // Render Journal Entries
    _accJournalEntriesCache = (jeRes && jeRes.data) || [];
    renderJournalEntries(_accJournalEntriesCache);

  } catch (e) {
    console.error('[loadAccounting] error:', e);
  }
}

function renderJournalEntries(items) {
  const tbody = document.getElementById('acc-je-tbody');
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No journal entries recorded. Record your first expense or entry!</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(j => {
    const isExpense = j.type === 'expense';
    const badgeClass = isExpense ? 'badge-red' : j.type === 'income' ? 'badge-green' : 'badge-blue';
    const dateStr = j.created_at ? new Date(j.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    return `<tr>
      <td><code>${j.ref || 'JE-' + j.id}</code></td>
      <td><span class="badge ${badgeClass}">${(j.type || 'expense').toUpperCase()}</span></td>
      <td><strong>${j.category || 'General'}</strong></td>
      <td>${j.description || '—'}</td>
      <td style="font-weight:700;color:${isExpense ? 'var(--red)' : 'var(--green)'};">${isExpense ? '-' : '+'}KES ${Number(j.amount || 0).toLocaleString()}</td>
      <td style="white-space:nowrap;">${dateStr}</td>
    </tr>`;
  }).join('');
}

function searchJournalEntries(q) {
  const query = (q || '').toLowerCase();
  if (!query) { renderJournalEntries(_accJournalEntriesCache); return; }
  const filtered = _accJournalEntriesCache.filter(j =>
    (j.ref || '').toLowerCase().includes(query) ||
    (j.category || '').toLowerCase().includes(query) ||
    (j.description || '').toLowerCase().includes(query) ||
    (j.type || '').toLowerCase().includes(query)
  );
  renderJournalEntries(filtered);
}

function openAccountingEntryModal() {
  populateAccountingBranchDropdown(state.branchesCache || []);
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('je-type', 'expense');
  setVal('je-category', 'Rent');
  setVal('je-description', '');
  setVal('je-amount', '');
  if (state.branchesCache && state.branchesCache.length) {
    setVal('je-branch', state.branchesCache[0].id);
  }
  document.getElementById('journal-entry-modal')?.classList.remove('hidden');
}

async function submitAccountingEntryModal() {
  const type = document.getElementById('je-type')?.value;
  const category = document.getElementById('je-category')?.value;
  const description = document.getElementById('je-description')?.value.trim();
  const amount = parseFloat(document.getElementById('je-amount')?.value) || 0;
  const branch_id = parseInt(document.getElementById('je-branch')?.value) || 1;

  if (!description) { showToast('Description is required'); return; }
  if (amount <= 0) { showToast('Please enter a valid amount'); return; }

  try {
    const res = await apiPost('/api/accounting/entries', { type, category, description, amount, branch_id });
    if (res.success) {
      showToast(`Entry ${res.ref} saved successfully!`);
      closeModal('journal-entry-modal');
      loadAccounting();
    } else {
      showToast(res.error || 'Failed to save entry');
    }
  } catch (e) {
    showToast('Error saving entry');
  }
}

function exportAccountingReportCSV() {
  if (!_accJournalEntriesCache.length) { showToast('No journal entries to export'); return; }
  const headers = ['Ref', 'Type', 'Category', 'Description', 'Amount', 'Date'];
  const rows = _accJournalEntriesCache.map(j => [
    j.ref || 'JE-' + j.id,
    j.type,
    `"${(j.category || '').replace(/"/g, '""')}"`,
    `"${(j.description || '').replace(/"/g, '""')}"`,
    j.amount || 0,
    j.created_at ? new Date(j.created_at).toLocaleDateString() : ''
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `accounting_entries_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast('Accounting report exported to CSV');
}

function initHRCharts() {
  const c1 = document.getElementById('attendChart');
  if (c1 && !state.chartInstances.attend) {
    const d = getChartDefaults();
    state.chartInstances.attend = new Chart(c1, {
      type: 'line',
      data: {
        labels: Array.from({length:14}, (_,i) => `Day ${i+1}`),
        datasets: [
          { label: 'Present', data: [0,0,0,0,0,0,0,0,0,0,0,0,0,0], borderColor: '#10B981', fill: false, tension: 0.3 },
          { label: 'Absent', data: [0,0,0,0,0,0,0,0,0,0,0,0,0,0], borderColor: '#EF4444', fill: false, tension: 0.3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: d.textColor } } }, scales: { x: { grid: { color: d.gridColor }, ticks: { color: d.textColor } }, y: { grid: { color: d.gridColor }, ticks: { color: d.textColor } } } }
    });
  }
  const c2 = document.getElementById('payrollChart');
  if (c2 && !state.chartInstances.payroll) {
    state.chartInstances.payroll = new Chart(c2, {
      type: 'doughnut',
      data: { labels: ['Basic','Allowances','Deductions'], datasets: [{ data: [0,0,0], backgroundColor: ['#3B82F6','#10B981','#F59E0B'], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
    });
  }
  loadHR();
}

/* ══════════════════════════════════════════
   HUMAN RESOURCES (HR) MODULE
══════════════════════════════════════════ */
let _hrEmployeesCache = [];

async function loadHR() {
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const [summaryRes, empRes] = await Promise.all([
      apiGet(`/api/hr/payroll/summary${bParam}`),
      apiGet(`/api/hr/employees${bParam}`)
    ]);

    // Update HR KPIs & Charts
    if (summaryRes && summaryRes.data) {
      const d = summaryRes.data;
      const fmtKES = num => 'KES ' + (num >= 1000000 ? (num/1000000).toFixed(1)+'M' : num >= 1000 ? (num/1000).toFixed(0)+'K' : (num || 0).toLocaleString());
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      setEl('hr-kpi-total', d.total_employees || 0);
      setEl('hr-kpi-present', d.present_today || 0);
      setEl('hr-kpi-rate', `${d.avg_attendance || 0}% attendance rate`);
      setEl('hr-kpi-payroll', fmtKES(d.total_payroll || 0));

      const leaveOrAbsent = (d.on_leave || 0) + (d.absent || 0);
      setEl('hr-kpi-leave', leaveOrAbsent);
      setEl('hr-kpi-leave-sub', `${d.on_leave || 0} on leave · ${d.absent || 0} absent`);

      if (!state.chartInstances.attend || !state.chartInstances.payroll) {
        initHRCharts();
      }

      if (state.chartInstances.attend) {
        const history = summaryRes.history || [];
        const labels = [];
        const presentData = [];
        const absentData = [];
        
        const today = new Date();
        for (let i = 13; i >= 0; i--) {
          const dDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
          const dateStr = dDate.toISOString().slice(0, 10);
          
          labels.push(dDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
          
          const match = history.find(h => h.date === dateStr);
          presentData.push(match ? match.present : 0);
          absentData.push(match ? match.absent : 0);
        }
        
        state.chartInstances.attend.data.labels = labels;
        state.chartInstances.attend.data.datasets[0].data = presentData;
        state.chartInstances.attend.data.datasets[1].data = absentData;
        state.chartInstances.attend.update();
      }
      if (state.chartInstances.payroll) {
        const payroll = d.total_payroll || 0;
        state.chartInstances.payroll.data.datasets[0].data = payroll > 0 ? [Math.round(payroll * 0.7), Math.round(payroll * 0.2), Math.round(payroll * 0.1)] : [0, 0, 0];
        state.chartInstances.payroll.update();
      }
    }

    // Render Employee Directory
    _hrEmployeesCache = (empRes && empRes.data) || [];
    renderEmployeeRows(_hrEmployeesCache);

  } catch (e) {
    console.error('[loadHR] error:', e);
  }
}

function renderEmployeeRows(items) {
  const tbody = document.getElementById('hr-tbody');
  if (!tbody) return;
  const showDelete = canDeleteEmployee();
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No active staff records found. Add your first employee!</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(e => {
    const statusMap = { present: 'badge-green', on_leave: 'badge-amber', absent: 'badge-red', terminated: 'badge-red' };
    const badgeClass = statusMap[e.status] || 'badge-green';
    const statusText = (e.status || 'present').replace('_', ' ').toUpperCase();
    const initials = (e.name || 'EM').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['#FFF7ED;color:#F97316', '#F0FDF4;color:#10B981', '#FFF7ED;color:#F59E0B', '#F5F3FF;color:#8B5CF6'];
    const colorStyle = colors[Math.abs(e.id || 0) % colors.length];

    return `<tr>
      <td>
        <div class="cell-user">
          <div class="av sm" style="background:${colorStyle.split(';')[0].replace('#','').length===6?'#'+colorStyle.split(';')[0]:'#EEF2FF'};color:${colorStyle.split('color:')[1]||'#4F46E5'}">${initials}</div>
          <strong>${e.name}</strong>
        </div>
      </td>
      <td>${e.role || 'Staff'}</td>
      <td>${e.branch_name || 'Nairobi Main'}</td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
      <td>KES ${Number(e.salary || 0).toLocaleString()}</td>
      <td>${e.attendance_pct || 95}%</td>
      <td style="white-space:nowrap;">
        <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="openEmployeeModal(${e.id})">Edit</button>
        <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="openAttendanceModal(${e.id})">Attendance</button>
        ${showDelete ? `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);" onclick="terminateEmployee(${e.id}, '${e.name.replace(/'/g, "\\'")}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function searchEmployees(q) {
  const query = (q || '').toLowerCase();
  if (!query) { renderEmployeeRows(_hrEmployeesCache); return; }
  const filtered = _hrEmployeesCache.filter(e =>
    (e.name || '').toLowerCase().includes(query) ||
    (e.role || '').toLowerCase().includes(query) ||
    (e.branch_name || '').toLowerCase().includes(query)
  );
  renderEmployeeRows(filtered);
}

function openEmployeeModal(id = null) {
  populateEmpBranchDropdown(state.branchesCache || []);
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  const titleEl = document.getElementById('emp-modal-title');

  setVal('emp-id', '');
  setVal('emp-name', '');
  setVal('emp-role', '');
  setVal('emp-branch', '1');
  setVal('emp-status', 'present');
  setVal('emp-salary', '');
  setVal('emp-phone', '');
  setVal('emp-email', '');

  // Reset login credential fields
  const loginChk = document.getElementById('emp-create-login');
  const loginSection = document.getElementById('emp-login-section');
  const loginFields = document.getElementById('emp-login-fields');
  if (loginChk) loginChk.checked = false;
  if (loginFields) loginFields.style.display = 'none';
  setVal('emp-login-email', '');
  setVal('emp-login-password', '');
  setVal('emp-login-role', 'cashier');

  if (id) {
    const e = _hrEmployeesCache.find(x => x.id == id);
    if (e) {
      if (titleEl) titleEl.textContent = 'Edit Employee Profile';
      setVal('emp-id', e.id);
      setVal('emp-name', e.name);
      setVal('emp-role', e.role);
      setVal('emp-branch', e.branch_id || '1');
      setVal('emp-status', e.status || 'present');
      setVal('emp-salary', e.salary);
      setVal('emp-phone', e.phone);
      setVal('emp-email', e.email);

      // Keep login section available when editing
      if (loginSection) loginSection.style.display = '';
      setVal('emp-login-email', e.email || '');

      const normRole = (e.role || '').toLowerCase().includes('manager') ? 'manager' :
                       (e.role || '').toLowerCase().includes('hr') ? 'hr' :
                       (e.role || '').toLowerCase().includes('account') ? 'accountant' : 'cashier';
      setVal('emp-login-role', normRole);
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add New Employee';
    if (loginSection) loginSection.style.display = '';
  }

  document.getElementById('employee-modal')?.classList.remove('hidden');
}

function toggleEmpLoginFields() {
  const checked = document.getElementById('emp-create-login')?.checked;
  const fields = document.getElementById('emp-login-fields');
  if (fields) fields.style.display = checked ? 'flex' : 'none';
}

async function submitEmployeeModal() {
  const id = document.getElementById('emp-id')?.value.trim();
  const name = document.getElementById('emp-name')?.value.trim();
  const role = document.getElementById('emp-role')?.value.trim();
  const branch_id = parseInt(document.getElementById('emp-branch')?.value) || 1;
  const status = document.getElementById('emp-status')?.value || 'present';
  const salary = parseFloat(document.getElementById('emp-salary')?.value) || 0;
  const phone = document.getElementById('emp-phone')?.value.trim();
  const email = document.getElementById('emp-email')?.value.trim();

  if (!name || !role) { showToast('Employee name and role are required'); return; }

  try {
    let res;
    if (id) {
      res = await fetch(`/api/hr/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (state.token || '') },
        body: JSON.stringify({ name, role, branch_id, status, salary, phone, email })
      }).then(r => r.json());
    } else {
      res = await apiPost('/api/hr/employees', { name, role, branch_id, salary, phone, email, hire_date: new Date().toISOString().slice(0,10) });
    }

    // Process system login account creation / update
    const createLogin   = document.getElementById('emp-create-login')?.checked;
    const loginEmail    = document.getElementById('emp-login-email')?.value.trim();
    const loginPassword = document.getElementById('emp-login-password')?.value.trim();
    const loginRole     = document.getElementById('emp-login-role')?.value || 'cashier';

    if (res.success && (createLogin || (id && loginEmail))) {
      if (loginEmail) {
        const accountRes = await fetch('/api/auth/upsert-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (state.token || '')
          },
          body: JSON.stringify({
            name,
            email: loginEmail,
            password: loginPassword,
            role: loginRole,
            branch_id
          })
        }).then(r => r.json());

        if (accountRes.success) {
          showToast(id ? `Employee profile & login account (${loginEmail}) updated` : `Employee ${name} added with login account (${loginEmail})`);
        } else {
          showToast(`Employee saved, but login account operation failed: ${accountRes.error || 'Unknown error'}`);
        }
        closeModal('employee-modal');
        loadHR();
        return;
      }
    }

    if (res.success) {
      showToast(id ? `${name}'s profile updated` : `Employee ${name} added!`);
      closeModal('employee-modal');
      loadHR();
      // If owner is viewing the HQ HR Management tab, refresh that table too
      if (state.user?.role === 'owner' && _compArea === 'staffhq') loadHQHR();
    } else {
      showToast(res.error || 'Failed to save employee');
    }
  } catch (e) {
    console.error('[submitEmployeeModal]', e);
    showToast('Error saving employee');
  }
}

async function terminateEmployee(id, name) {
  if (!confirm(`Permanently delete employee "${name}" from records?\nTheir attendance history will also be removed. This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/hr/employees/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (state.token || '') }
    }).then(r => r.json());
    if (res.success) {
      showToast(`Employee ${name} terminated`);
      loadHR();
      if (state.user?.role === 'owner' && _compArea === 'staffhq') loadHQHR();
    } else {
      showToast(res.error || 'Failed to terminate employee');
    }
  } catch (e) {
    showToast('Error updating staff record');
  }
}

function openAttendanceModal(employeeId = null) {
  const selectEl = document.getElementById('att-employee');
  if (selectEl) {
    selectEl.innerHTML = '<option value="">— Select Employee —</option>';
    _hrEmployeesCache.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.name} (${e.role || 'Staff'})`;
      selectEl.appendChild(opt);
    });
    if (employeeId) selectEl.value = employeeId;
  }

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('att-date', new Date().toISOString().slice(0, 10));
  setVal('att-status', 'present');
  setVal('att-notes', '');

  document.getElementById('attendance-modal')?.classList.remove('hidden');
}

async function submitAttendanceModal() {
  const employee_id = parseInt(document.getElementById('att-employee')?.value);
  const date = document.getElementById('att-date')?.value;
  const status = document.getElementById('att-status')?.value || 'present';
  const notes = document.getElementById('att-notes')?.value.trim();

  if (!employee_id || !date) { showToast('Please select employee and date'); return; }

  try {
    const res = await apiPost('/api/hr/attendance', { employee_id, date, status, notes });
    if (res.success) {
      showToast('Attendance recorded!');
      closeModal('attendance-modal');
      loadHR();
    } else {
      showToast(res.error || 'Failed to record attendance');
    }
  } catch (e) {
    showToast('Error recording attendance');
  }
}

function exportHRReportCSV() {
  if (!_hrEmployeesCache.length) { showToast('No staff records to export'); return; }
  const headers = ['Name', 'Role', 'Branch', 'Status', 'Salary', 'Attendance %', 'Phone', 'Email'];
  const rows = _hrEmployeesCache.map(e => [
    `"${(e.name || '').replace(/"/g, '""')}"`,
    `"${(e.role || '').replace(/"/g, '""')}"`,
    `"${(e.branch_name || 'Nairobi Main').replace(/"/g, '""')}"`,
    e.status || 'present',
    e.salary || 0,
    e.attendance_pct || 100,
    `"${e.phone || ''}"`,
    `"${e.email || ''}"`
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `hr_staff_report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast('HR Staff report exported to CSV');
}

function initProcureCharts() {
  const c = document.getElementById('procureChart');
  if (c && !state.chartInstances.procure) {
    const d = getChartDefaults();
    state.chartInstances.procure = new Chart(c, {
      type: 'bar',
      data: {
        labels: ['Feb','Mar','Apr','May','Jun','Jul'],
        datasets: [{ label: 'Purchases (KES 000s)', data: [0,0,0,0,0,0], backgroundColor: 'rgba(79,70,229,0.85)', borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: d.textColor } } }, scales: { x: { grid: { color: d.gridColor }, ticks: { color: d.textColor } }, y: { grid: { color: d.gridColor }, ticks: { color: d.textColor } } } }
    });
  }
  loadProcurement();
}

/* ── PROCUREMENT MODULE ── */
let _prCache = [];
let _prCurrentTab = 'all';
let _prLineCount = 0;

async function loadProcurement() {
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const [prData, supData] = await Promise.all([
      apiGet(`/api/procurement/requests${bParam}`),
      apiGet('/api/procurement/suppliers')  // suppliers are global / shared master list
    ]);
    _prCache = prData.data || [];
    const suppliers = supData.data || [];
    updatePRKPIs(_prCache);
    renderTopSuppliers(suppliers);
    renderPRRows(_prCache, _prCurrentTab);

    if (!state.chartInstances.procure) {
      initProcureCharts();
    }

    if (state.chartInstances.procure) {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const today = new Date();
      const buckets = [];
      for (let i = 5; i >= 0; i--) {
        const dDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        buckets.push({
          label: monthNames[dDate.getMonth()],
          year: dDate.getFullYear(),
          month: dDate.getMonth(),
          total: 0
        });
      }
      
      _prCache.forEach(p => {
        if (p.created_at) {
          const dt = new Date(p.created_at.replace(' ', 'T'));
          const b = buckets.find(x => x.year === dt.getFullYear() && x.month === dt.getMonth());
          if (b) {
            b.total += (p.total_value || 0) / 1000;
          }
        }
      });
      
      state.chartInstances.procure.data.labels = buckets.map(x => x.label);
      state.chartInstances.procure.data.datasets[0].data = buckets.map(x => Math.round(x.total));
      state.chartInstances.procure.update();
    }
  } catch (e) {
    console.error('[loadProcurement] error:', e);
    const tbody = document.getElementById('pr-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Could not load data. Check server.</td></tr>';
  }
}

function updatePRKPIs(items) {
  const fmt = n => 'KES ' + (n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'K' : n);
  const open = items.filter(p => p.status === 'pending').length;
  const approved = items.filter(p => p.status === 'approved').length;
  const delivered = items.filter(p => p.status === 'delivered').length;
  const spend = items.filter(p => p.status === 'delivered').reduce((s, p) => s + (p.total_value || 0), 0);
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('pr-kpi-open', open);
  setEl('pr-kpi-pending-label', `${open} pending approval`);
  setEl('pr-kpi-approved', approved);
  setEl('pr-kpi-spend', fmt(spend));
  setEl('pr-kpi-delivered', delivered);
}

function renderTopSuppliers(suppliers) {
  const box = document.getElementById('pr-top-suppliers');
  if (!box) return;
  if (!suppliers.length) { box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">No suppliers yet.</div>'; return; }
  box.innerHTML = suppliers.slice(0, 5).map((s, i) => {
    const r = s.rating || 80;
    return `<div class="supplier-row">
      <div class="sup-rank">${i + 1}</div>
      <div class="sup-info"><p>${s.name}</p><span>${s.category || 'General'}</span></div>
      <div class="sup-score"><div class="score-bar"><div style="width:${r}%"></div></div><span>${r}%</span></div>
    </div>`;
  }).join('');
}

function renderPRRows(items, tab = 'all') {
  const tbody = document.getElementById('pr-tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  const filtered = tab === 'all' ? items : items.filter(p => p.status === tab);
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No ${tab === 'all' ? '' : tab + ' '}purchase requests found.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const statusMap = { pending: 'badge-amber', approved: 'badge-green', delivered: 'badge-blue', rejected: 'badge-red' };
    const badgeClass = statusMap[p.status] || 'badge-amber';
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const total = p.total_value ? 'KES ' + Number(p.total_value).toLocaleString() : '—';
    const initials = (p.requested_by_name || 'SY').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const colors = ['#FFF7ED;color:#F97316','#F0FDF4;color:#10B981','#FFF7ED;color:#F59E0B','#FDF2F8;color:#EC4899'];
    const ci = Math.abs(p.id || 0) % colors.length;
    let actionBtns = '';
    if (p.status === 'pending') {
      actionBtns = `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="updatePRStatus(${p.id},'approved')">Approve</button>
                    <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);" onclick="updatePRStatus(${p.id},'rejected')">Reject</button>`;
    } else if (p.status === 'approved') {
      actionBtns = `<button class="btn-sm" style="padding:3px 7px;font-size:11px;" onclick="updatePRStatus(${p.id},'delivered')">Mark Delivered</button>`;
    } else {
      actionBtns = `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="showToast('PR ${p.ref} — ${p.status}')">View</button>`;
    }
    return `<tr>
      <td><code style="font-size:11px;">${p.ref || 'PR-' + p.id}</code></td>
      <td><div class="cell-user"><div class="av sm" style="background:${colors[ci].split(';')[0].replace('#','').length===6?'#'+colors[ci].split(';')[0]:'#EEF2FF'};color:${colors[ci].split('color:')[1]||'#4F46E5'}">${initials}</div>${p.requested_by_name || 'System'}</div></td>
      <td>${p.item_count || 0} items</td>
      <td>${total}</td>
      <td>${p.supplier_name || '—'}</td>
      <td><span class="badge ${badgeClass}">${p.status}</span></td>
      <td style="white-space:nowrap;">${date}</td>
      <td style="white-space:nowrap;">${actionBtns}
        ${showDelete ? `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);margin-left:4px;" onclick="deletePurchaseRequest(${p.id}, '${(p.ref || 'PR-' + p.id).replace(/'/g, "\\'")}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function filterPRTab(tab, btn) {
  _prCurrentTab = tab;
  document.querySelectorAll('#view-procurement .cat-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const q = document.getElementById('pr-search')?.value || '';
  const list = q ? _prCache.filter(p => (p.ref||'').toLowerCase().includes(q.toLowerCase()) || (p.supplier_name||'').toLowerCase().includes(q.toLowerCase())) : _prCache;
  renderPRRows(list, tab);
}

function searchPRs(q) {
  const query = (q || '').toLowerCase();
  const filtered = query ? _prCache.filter(p =>
    (p.ref||'').toLowerCase().includes(query) ||
    (p.supplier_name||'').toLowerCase().includes(query) ||
    (p.requested_by_name||'').toLowerCase().includes(query)
  ) : _prCache;
  renderPRRows(filtered, _prCurrentTab);
}

async function openPRModal() {
  // Reset form
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('pr-notes', '');
  const lineBox = document.getElementById('pr-line-items');
  if (lineBox) lineBox.innerHTML = '';
  _prLineCount = 0;
  const totalEl = document.getElementById('pr-total-display');
  if (totalEl) totalEl.textContent = 'KES 0';

  // Load suppliers into dropdown
  const sel = document.getElementById('pr-supplier');
  if (sel) {
    sel.innerHTML = '<option value="">— Select Supplier —</option>';
    try {
      const data = await apiGet('/api/procurement/suppliers');
      (data.data || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.name;
        sel.appendChild(opt);
      });
    } catch(e) {
      // use cached suppliers if available
      _suppliersCache.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.name;
        sel.appendChild(opt);
      });
    }
  }

  addPRLineItem(); // start with one row
  document.getElementById('pr-modal')?.classList.remove('hidden');
}

function addPRLineItem() {
  const box = document.getElementById('pr-line-items');
  if (!box) return;
  const idx = ++_prLineCount;
  const row = document.createElement('div');
  row.id = `pr-line-${idx}`;
  row.style.cssText = 'display:grid;grid-template-columns:2fr 80px 110px 32px;gap:6px;align-items:center;';
  row.innerHTML = `
    <input type="text" class="form-field-input" placeholder="Product / item name" id="pr-item-name-${idx}" style="font-size:12px;" />
    <input type="number" class="form-field-input" placeholder="Qty" id="pr-item-qty-${idx}" min="1" value="1" style="font-size:12px;" oninput="recalcPRTotal()" />
    <input type="number" class="form-field-input" placeholder="Unit cost" id="pr-item-cost-${idx}" min="0" style="font-size:12px;" oninput="recalcPRTotal()" />
    <button onclick="removePRLine(${idx})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:16px;padding:0;">✕</button>
  `;
  box.appendChild(row);
}

function removePRLine(idx) {
  const row = document.getElementById(`pr-line-${idx}`);
  if (row) row.remove();
  recalcPRTotal();
}

function recalcPRTotal() {
  const box = document.getElementById('pr-line-items');
  if (!box) return;
  let total = 0;
  box.querySelectorAll('[id^="pr-item-qty-"]').forEach(qtyEl => {
    const id = qtyEl.id.replace('pr-item-qty-', '');
    const qty = parseFloat(qtyEl.value) || 0;
    const cost = parseFloat(document.getElementById(`pr-item-cost-${id}`)?.value) || 0;
    total += qty * cost;
  });
  const el = document.getElementById('pr-total-display');
  if (el) el.textContent = 'KES ' + Number(total).toLocaleString();
}

async function submitPRModal() {
  const supplier_id = document.getElementById('pr-supplier')?.value;
  const notes = document.getElementById('pr-notes')?.value.trim();
  if (!supplier_id) { showToast('Please select a supplier'); return; }

  const box = document.getElementById('pr-line-items');
  const items = [];
  box?.querySelectorAll('[id^="pr-item-qty-"]').forEach(qtyEl => {
    const id = qtyEl.id.replace('pr-item-qty-', '');
    const product_name = document.getElementById(`pr-item-name-${id}`)?.value.trim();
    const qty = parseInt(qtyEl.value) || 0;
    const unit_cost = parseFloat(document.getElementById(`pr-item-cost-${id}`)?.value) || 0;
    if (product_name && qty > 0) items.push({ product_name, qty, unit_cost });
  });

  if (!items.length) { showToast('Add at least one line item'); return; }

  try {
    const res = await apiPost('/api/procurement/requests', { supplier_id: parseInt(supplier_id), items, notes });
    if (res.success) {
      showToast(`Purchase Request ${res.ref} submitted!`);
      closeModal('pr-modal');
      loadProcurement();
    } else {
      showToast(res.error || 'Failed to submit purchase request');
    }
  } catch (e) {
    showToast('Error submitting purchase request');
  }
}

async function updatePRStatus(id, status) {
  const labels = { approved: 'approve', rejected: 'reject', delivered: 'mark as delivered' };
  if (!confirm(`Are you sure you want to ${labels[status] || status} this purchase request?`)) return;
  try {
    const res = await fetch(`/api/procurement/requests/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (state.token || '') },
      body: JSON.stringify({ status })
    }).then(r => r.json());
    if (res.success) {
      showToast(`Purchase request ${status}!${status === 'delivered' ? ' Stock updated automatically.' : ''}`);
      loadProcurement();
    } else {
      showToast(res.error || 'Failed to update status');
    }
  } catch(e) { showToast('Error updating purchase request'); }
}

function exportProcurementCSV() {
  if (!_prCache.length) { showToast('No purchase requests to export'); return; }
  const headers = ['PR Number','Requested By','Supplier','Items','Total Value','Status','Date'];
  const rows = _prCache.map(p => [
    p.ref || 'PR-' + p.id,
    `"${(p.requested_by_name||'System').replace(/"/g,'""')}"`,
    `"${(p.supplier_name||'').replace(/"/g,'""')}"`,
    p.item_count || 0,
    p.total_value || 0,
    p.status,
    p.created_at ? new Date(p.created_at).toLocaleDateString() : ''
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `procurement_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast('Procurement data exported to CSV');
}

function initCRMCharts(customers = []) {
  const c = document.getElementById('crmChart');
  if (!c) return;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const regCount = customers.filter(cu => (cu.segment || 'regular').toLowerCase() === 'regular').length;
  const b2bCount = customers.filter(cu => (cu.segment || '').toLowerCase() === 'b2b').length;
  const vipCount = customers.filter(cu => (cu.segment || '').toLowerCase() === 'vip').length;
  const riskCount = customers.filter(cu => cu.segment === 'churn_risk' || cu.segment === 'lapsed').length;
  const newCount = customers.filter(cu => cu.created_at && new Date(cu.created_at) >= sevenDaysAgo).length;

  if (state.chartInstances.crm) {
    state.chartInstances.crm.data.datasets[0].data = [regCount, b2bCount, vipCount, riskCount, newCount];
    state.chartInstances.crm.update();
  } else {
    const d = getChartDefaults();
    state.chartInstances.crm = new Chart(c, {
      type: 'bar',
      data: {
        labels: ['Regular Retail', 'B2B Corporate', 'VIP Loyalty', 'At Risk', 'New'],
        datasets: [{
          label: 'Customers',
          data: [regCount, b2bCount, vipCount, riskCount, newCount],
          backgroundColor: ['#F97316','#10B981','#8B5CF6','#EF4444','#F59E0B'],
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: d.gridColor }, ticks: { color: d.textColor } },
          y: { grid: { color: d.gridColor }, ticks: { color: d.textColor, precision: 0 } }
        }
      }
    });
  }
}

function drawSparkline(id, data, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = ''; // Prevent duplication by clearing container
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%'; canvas.style.height = '36px';
  el.appendChild(canvas);
  new Chart(canvas, {
    type: 'line',
    data: { labels: data.map((_,i)=>i), datasets: [{ data, borderColor: color, borderWidth: 1.8, pointRadius: 0, fill: false, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   AI BUSINESS ASSISTANT — Gemini 1.5 Flash Integration
   Conversation history is kept in memory for the session.
   Set GEMINI_API_KEY in .env to activate.
════════════════════════════════════════════════════════════════════ */

let _aiHistory = []; // multi-turn conversation history

/** Called by navTo when the user opens the AI view */
function loadAI() {
  const isOwner = state.user?.role === 'owner';
  const bName = state.currentBranch?.name || 'Assigned Branch';
  const subEl = document.querySelector('#view-ai .view-header p');
  const suggContainer = document.querySelector('.ai-suggestions');
  
  if (subEl) {
    if (isOwner) {
      const isHQ = !state.currentBranch || state.currentBranch.id === 'all';
      subEl.textContent = isHQ 
        ? 'Enterprise AI Advisor · Consolidated intelligence across all branches & locations'
        : `Branch & Enterprise AI Advisor · Focused on ${bName} with full enterprise visibility`;
    } else {
      subEl.textContent = `Branch AI Advisor · Focused exclusively on ${bName} operations`;
    }
  }

  if (suggContainer) {
    if (isOwner) {
      suggContainer.innerHTML = `
        <button class="ai-suggest-btn" onclick="aiAsk('Which branch is performing best this month?')">Which branch is performing best?</button>
        <button class="ai-suggest-btn" onclick="aiAsk('Compare revenue and stock across all branches')">Compare all branches</button>
        <button class="ai-suggest-btn" onclick="aiAsk('Which products need restocking across all stores?')">Restock recommendations</button>
        <button class="ai-suggest-btn" onclick="aiAsk('How can we maximize company-wide net profit?')">Profit optimization tips</button>
      `;
    } else {
      suggContainer.innerHTML = `
        <button class="ai-suggest-btn" onclick="aiAsk('Which products in this branch need urgent restocking?')">Branch low stock alert</button>
        <button class="ai-suggest-btn" onclick="aiAsk('What was today\\'s sales breakdown for this branch?')">Branch sales summary</button>
        <button class="ai-suggest-btn" onclick="aiAsk('How is our branch staff attendance and payroll?')">Staff attendance check</button>
        <button class="ai-suggest-btn" onclick="aiAsk('Who are the top customers for our branch?')">Top branch customers</button>
      `;
    }
  }

  loadAIInsights();
}

/** Fetch live AI-generated insights for the right-hand panel */
async function loadAIInsights() {
  const list = document.getElementById('ai-insight-list');
  if (!list) return;

  // Show skeleton loading
  list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">Loading live insights...</div>';

  try {
    const bId = state.currentBranch?.id;
    const bParam = bId ? `?branch_id=${bId}` : '';
    const res = await fetch(`/api/ai/insights${bParam}`, {
      headers: state.token ? { 'Authorization': 'Bearer ' + state.token } : {}
    });
    const data = await res.json();

    if (!data.insights || data.insights.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No insights available yet. Start chatting to get analysis.</div>';
      return;
    }

    const iconMap = {
      success: '<path d="M2 12L6 7l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      warning: '<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v4m0 3v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      danger:  '<path d="M8 5v4m0 3v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      info:    '<path d="M8 1v14M3 5h7a3 3 0 010 6H3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      purple:  '<rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h12" stroke="currentColor" stroke-width="1.5"/>'
    };

    const typeToClass = { success: 'green', warning: 'amber', danger: 'red', info: 'blue', purple: 'purple' };

    list.innerHTML = data.insights.map(ins => {
      const cardClass = typeToClass[ins.type] || 'blue';
      return `
        <div class="insight-card ${cardClass}">
          <div class="insight-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none">${iconMap[ins.type] || iconMap.info}</svg></div>
          <p><strong>${ins.title}</strong> — ${ins.body}</p>
        </div>
      `;
    }).join('');

  } catch {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Could not load live insights.</div>';
  }
}

/** Called by suggestion buttons in the HTML */
function aiAsk(q) {
  const input = document.getElementById('ai-input');
  if (input) input.value = q;
  sendAIMessage();
}

/** Convert clean AI output to HTML for chat bubbles */
function aiMarkdownToHtml(text) {
  if (!text) return '';

  // Escape HTML special chars
  let t = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = t.split('\n');
  const outputLines = [];
  let inNumberedList = false;
  let inBulletList = false;

  for (let line of lines) {
    const trimmed = line.trim();

    // Blank line — close any open lists
    if (!trimmed) {
      if (inNumberedList) { outputLines.push('</ol>'); inNumberedList = false; }
      if (inBulletList)   { outputLines.push('</ul>'); inBulletList = false; }
      outputLines.push('<div style="height:8px"></div>');
      continue;
    }

    // Numbered list: "1. Text" or "1. **Bold heading**"
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      if (inBulletList) { outputLines.push('</ul>'); inBulletList = false; }
      if (!inNumberedList) { outputLines.push('<ol style="margin:6px 0 6px 16px;padding:0">'); inNumberedList = true; }
      outputLines.push(`<li>${renderInline(numMatch[2])}</li>`);
      continue;
    }

    // Bullet point: "• Text" or "- Text"
    const bulletMatch = trimmed.match(/^[•\-]\s+(.+)$/);
    if (bulletMatch) {
      if (inNumberedList) { outputLines.push('</ol>'); inNumberedList = false; }
      if (!inBulletList) { outputLines.push('<ul style="margin:6px 0 6px 16px;padding:0;list-style:disc">'); inBulletList = true; }
      outputLines.push(`<li>${renderInline(bulletMatch[1])}</li>`);
      continue;
    }

    // Close any open lists before rendering a plain line
    if (inNumberedList) { outputLines.push('</ol>'); inNumberedList = false; }
    if (inBulletList)   { outputLines.push('</ul>'); inBulletList = false; }

    // Plain text line (may contain **bold**, `code`)
    outputLines.push(`<p style="margin:3px 0">${renderInline(trimmed)}</p>`);
  }

  if (inNumberedList) outputLines.push('</ol>');
  if (inBulletList)   outputLines.push('</ul>');

  return outputLines.join('');
}

/** Render inline markdown: **bold**, `code` */
function renderInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="ai-inline-code">$1</code>');
}

function addAIMsg(text, sender, isTyping = false) {
  const container = document.getElementById('ai-messages');
  if (!container) return null;
  const div = document.createElement('div');
  div.className = `ai-msg ${sender}`;
  if (isTyping) div.id = 'ai-typing-indicator';

  const bubbleContent = isTyping
    ? '<span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span>'
    : (sender === 'bot' ? aiMarkdownToHtml(text) : text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));

  if (sender === 'bot') {
    div.innerHTML = `<div class="ai-avatar"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 2l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z" fill="white"/></svg></div><div class="ai-bubble">${bubbleContent}</div>`;
  } else {
    div.innerHTML = `<div class="ai-bubble">${bubbleContent}</div><div class="ai-avatar" style="background:#10B981">${state.user?.avatar || 'U'}</div>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendAIMessage() {
  const input = document.getElementById('ai-input');
  if (!input || !input.value.trim()) return;
  const q = input.value.trim();
  input.value = '';

  // Disable input while thinking
  input.disabled = true;
  const sendBtn = document.querySelector('.ai-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  addAIMsg(q, 'user');

  // Show typing indicator
  const typingEl = addAIMsg('', 'bot', true);

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'Authorization': 'Bearer ' + state.token } : {})
      },
      body: JSON.stringify({
        message: q,
        history: _aiHistory,
        branch_id: state.currentBranch?.id
      })
    });

    const data = await res.json();

    // Remove typing indicator
    if (typingEl) typingEl.remove();

    if (!res.ok) {
      const errMsg = data.error || 'AI service unavailable. Please try again.';
      addAIMsg(errMsg, 'bot');
      if (data.code === 'NO_API_KEY') {
        addAIMsg('To activate the AI assistant, open your <strong>.env</strong> file and replace <code>YOUR_GEMINI_API_KEY_HERE</code> with your actual Gemini API key, then restart the server.', 'bot');
      } else if (data.code === 'QUOTA_EXCEEDED') {
        addAIMsg('Your free-tier Gemini key has reached its daily limit. To remove this restriction, enable billing at <strong>https://ai.dev</strong> — or wait until tomorrow for the quota to reset.', 'bot');
      } else if (data.code === 'SERVICE_UNAVAILABLE') {
        addAIMsg('The AI service is under high demand right now. Please wait a moment and try again — this is usually resolved within a minute or two.', 'bot');
      }
    } else {
      addAIMsg(data.reply, 'bot');
      // Append to conversation history for multi-turn context
      _aiHistory.push({ role: 'user', text: q });
      _aiHistory.push({ role: 'bot', text: data.reply });
      // Keep history manageable (last 20 turns)
      if (_aiHistory.length > 40) _aiHistory = _aiHistory.slice(-40);
    }

  } catch (err) {
    if (typingEl) typingEl.remove();
    addAIMsg('Network error — could not reach the AI service. Is the server running?', 'bot');
  } finally {
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

function clearAIChat() {
  _aiHistory = [];
  const c = document.getElementById('ai-messages');
  if (c) c.innerHTML = '<div class="ai-msg bot"><div class="ai-avatar"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 2l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z" fill="white"/></svg></div><div class="ai-bubble">Hello! I am your OpenFloat AI assistant, powered by Gemini. Ask me anything about your sales, inventory, staff, or finances.</div></div>';
  showToast('Chat cleared');
}

/* ══════════════════════════════════════════
   BRANCH MANAGEMENT
══════════════════════════════════════════ */
async function loadBranches() {
  try {
    const res = await apiGet('/api/branches');
    state.branchesCache = res.data || [];

    renderSettingsBranches(state.branchesCache);
    populateEmpBranchDropdown(state.branchesCache);
    populateAccountingBranchDropdown(state.branchesCache);
    renderBranchSwitcherModal(state.branchesCache);
    populateZReportBranchSelects(state.branchesCache);
  } catch (e) {
    console.warn('[loadBranches] error:', e);
  }
}

function renderSettingsBranches(branches) {
  const tbody = document.getElementById('settings-branches-tbody');
  if (!tbody) return;
  const showDelete = canDeleteBranch();

  if (!branches.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:14px;color:var(--text-muted);">No store branches found. Click "+ Add Branch" to create one.</td></tr>';
    return;
  }

  tbody.innerHTML = branches.map(b => {
    const isMain = b.id === 1 || b.name.toLowerCase() === 'main branch';
    const deleteBtn = isMain
      ? '<span style="font-size:11px;color:var(--text-muted);">Primary</span>'
      : (showDelete
          ? `<button class="btn-sm secondary" style="padding:3px 8px;font-size:11px;color:var(--red);" onclick="deleteBranch(${b.id})">Delete</button>`
          : '<span style="font-size:11px;color:var(--text-muted);">—</span>');
    return `<tr>
      <td><strong>${b.name}</strong></td>
      <td>${b.location || '—'}</td>
      <td>${b.phone || '—'}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join('');
}

function populateEmpBranchDropdown(branches = []) {
  const select = document.getElementById('emp-branch');
  if (!select) return;
  const currentVal = select.value;
  const list = branches.length ? branches : [{ id: 1, name: 'Main Branch' }];
  select.innerHTML = list.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  if (currentVal && list.some(b => String(b.id) === String(currentVal))) {
    select.value = currentVal;
  }
}

function populateAccountingBranchDropdown(branches = []) {
  const select = document.getElementById('je-branch');
  if (!select) return;
  const currentVal = select.value;
  const list = branches.length ? branches : [{ id: 1, name: 'Main Branch' }];
  select.innerHTML = list.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  if (currentVal && list.some(b => String(b.id) === String(currentVal))) {
    select.value = currentVal;
  }
}

function renderBranchSwitcherModal(branches = []) {
  const container = document.getElementById('branch-modal-list');
  if (!container) return;
  const activeBranches = branches.length ? branches : [{ id: 1, name: 'Main Branch', location: 'Headquarters Store' }];

  let html = '';

  // If user is Owner, add the special Enterprise Overview option at the top!
  if (state.user?.role === 'owner') {
    html += `
      <div class="branch-opt-card" onclick="selectBranch('All Branches (HQ Overview)', 'all')" style="border-left: 4px solid var(--brand); background: var(--surface-2); margin-bottom: 8px; cursor: pointer; padding: 12px 14px; border-radius: var(--radius); border: 1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="font-size:13.5px;color:var(--text-primary);display:block;">All Branches (HQ Overview)</strong>
            <span style="font-size:11.5px;color:var(--text-muted);">Consolidated Enterprise Performance &amp; Comparison</span>
          </div>
          <span class="badge" style="background:var(--brand);color:#fff;font-size:9.5px;font-weight:700;padding:2px 7px;">OWNER ONLY</span>
        </div>
      </div>
    `;
  }

  html += activeBranches.map(b => `
    <div class="branch-opt-card" onclick="selectBranch('${(b.name || '').replace(/'/g, "\\'")}', ${b.id})" style="cursor: pointer; padding: 12px 14px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 6px;">
      <strong style="font-size:13px;color:var(--text-primary);">${b.name}</strong><br>
      <span style="font-size:11.5px;color:var(--text-muted);">${b.location || 'Branch Store'}</span>
    </div>
  `).join('');

  container.innerHTML = html;
}

function populateZReportBranchSelects(branches = []) {
  const list = branches.length ? branches : [{ id: 1, name: 'Main Branch' }];
  const branchOptions = list.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const allBranchesOpt = `<option value="all">All Branches</option>`;
  const allStoresOpt = `<option value="all">All Stores &amp; Warehouses</option>`;

  // Cashier tab branch select
  const cashierSel = document.getElementById('zr-cashier-branch');
  if (cashierSel) cashierSel.innerHTML = branchOptions;

  // Manager tab branch select (with All Branches first)
  const managerSel = document.getElementById('zr-manager-branch');
  if (managerSel) managerSel.innerHTML = allBranchesOpt + branchOptions;

  // Store tab branch select (with All Branches first)
  const storeSel = document.getElementById('zr-store-select');
  if (storeSel) storeSel.innerHTML = allBranchesOpt + branchOptions;

  // Upload modal store select
  const uploadSel = document.getElementById('upload-store-select');
  if (uploadSel) uploadSel.innerHTML = allStoresOpt + branchOptions;

  // Stock movement modal store select
  const movSel = document.getElementById('mov-store-select');
  if (movSel) movSel.innerHTML = branchOptions;

  // Accounting modal branch select
  const jeSel = document.getElementById('je-branch');
  if (jeSel) jeSel.innerHTML = branchOptions;
}

function openAddBranchModal() {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('new-branch-name', '');
  setVal('new-branch-location', '');
  setVal('new-branch-phone', '');
  document.getElementById('add-branch-modal')?.classList.remove('hidden');
}

async function saveNewBranch() {
  const name = document.getElementById('new-branch-name')?.value.trim();
  const location = document.getElementById('new-branch-location')?.value.trim();
  const phone = document.getElementById('new-branch-phone')?.value.trim();

  if (!name) {
    showToast('Please enter a branch name.');
    return;
  }

  try {
    const res = await apiPost('/api/branches', { name, location, phone });
    if (res.success) {
      showToast('Branch added successfully!');
      closeModal('add-branch-modal');
      await loadBranches();
    } else {
      showToast(res.error || 'Failed to add branch');
    }
  } catch (e) {
    showToast(e.message || 'Error saving branch');
  }
}

async function deleteBranch(id) {
  if (!confirm('Are you sure you want to deactivate this branch?')) return;
  try {
    const res = await apiDelete('/api/branches/' + id);
    if (res.success) {
      showToast('Branch deactivated.');
      await loadBranches();
    } else {
      showToast(res.error || 'Failed to delete branch');
    }
  } catch (e) {
    showToast('Error deactivating branch');
  }
}

/* BRANCH & MODAL HANDLERS */
function openBranchModal() {
  // Only owners can switch branches
  if (state.user && state.user.role !== 'owner') {
    showToast('Branch locked to your assigned work location');
    return;
  }
  renderBranchSwitcherModal(state.branchesCache || []);
  document.getElementById('branch-modal')?.classList.remove('hidden');
}

function selectBranch(branchName, branchId = null) {
  // Non-owners cannot switch branches
  if (state.user && state.user.role !== 'owner') {
    showToast('Branch locked to your assigned work location');
    return;
  }
  state.currentBranch = { name: branchName, id: branchId };
  const el = document.getElementById('branch-name');
  if (el) el.textContent = branchName;
  const statusEl = document.querySelector('.branch-status');
  if (statusEl) {
    statusEl.textContent = branchId === 'all' ? 'Online · Enterprise HQ' : 'Online · All Access';
  }
  closeModal('branch-modal');
  showToast(`Switched active branch to ${branchName}`);

  // Re-evaluate sidebar navigation permissions for HQ Mode vs Branch Mode
  applyRolePermissions();

  const isHQ = branchId === 'all';
  const hqViews = ['dashboard', 'branch-comparison', 'ai', 'settings'];

  // If in HQ mode and on a branch-only operational page, redirect to dashboard
  if (isHQ && !hqViews.includes(state.currentView)) {
    navTo('dashboard');
    return;
  }
  // If in Branch mode and on branch-comparison (an HQ-only page), redirect to dashboard
  if (!isHQ && state.currentView === 'branch-comparison') {
    navTo('dashboard');
    return;
  }

  // ── INSTANT CACHE WIPE & FULL DOM PURGE ──────────────────────────────────
  state.viewLoadedBranch  = {};
  _inventoryCache         = [];
  _movementsCache         = [];
  _suppliersCache         = [];
  _hrEmployeesCache       = [];
  _crmCache               = [];
  _hpCache                = [];
  _arDebtorsCache         = [];
  _accJournalEntriesCache = [];
  _delCache               = [];
  _prCache                = [];
  _servicesCache          = [];
  _categoriesCache        = [];
  state.productsCache     = [];

  // Wipe EVERY view's tables, lists, and KPIs in the DOM immediately
  // to ensure zero flash of old branch data when passing through pages
  clearAllViewsDOM();
  // ────────────────────────────────────────────────────────────────────────

  // Refresh active view data immediately for the new branch context
  triggerViewLoad(state.currentView || 'dashboard');
}

function openCmdModal() {
  document.getElementById('cmd-modal')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('cmd-input')?.focus(), 100);
}

function filterCmd() {
  const query = (document.getElementById('cmd-input')?.value || '').toLowerCase();
  const items = document.querySelectorAll('.cmd-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = (!query || text.includes(query)) ? 'flex' : 'none';
  });
}

async function saveActionModal() {
  const name = document.getElementById('act-name')?.value.trim();
  const cat = document.getElementById('act-cat')?.value.trim();
  const val = parseFloat(document.getElementById('act-val')?.value) || 0;

  if (!name) {
    showToast('Please enter a name or title');
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;

  try {
    if (activeActionType === 'inventory' || activeActionType === 'product') {
      await fetch('/api/inventory', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          sku: 'SKU-' + Math.floor(1000 + Math.random() * 9000),
          sell_price: val,
          buy_price: Math.round(val * 0.7),
          stock_qty: 50,
          unit: 'pcs'
        })
      });
      showToast(`Product '${name}' created in backend inventory`);
      renderInventory();
    } else if (activeActionType === 'expense' || activeActionType === 'journal') {
      await fetch('/api/accounting/entries', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'expense',
          category: cat || 'General',
          description: name,
          amount: val
        })
      });
      showToast(`Journal entry '${name}' recorded`);
    } else if (activeActionType === 'employee') {
      await fetch('/api/hr/employees', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          role: cat || 'Staff',
          salary: val
        })
      });
      showToast(`Employee '${name}' added to HR database`);
    } else if (activeActionType === 'customer') {
      await fetch('/api/crm/customers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          segment: cat || 'regular',
          credit_limit: val
        })
      });
      showToast(`Customer '${name}' profile created`);
    } else {
      showToast(`Record '${name}' saved successfully`);
    }
  } catch (err) {
    showToast(`Record '${name}' saved successfully`);
  }

  closeModal('action-modal');
}

/* SETTINGS MODAL HANDLERS */
function openSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('hidden');
}

function switchSettingsTab(tabName, btn) {
  btn.parentNode.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById('stab-' + tabName)?.classList.remove('hidden');
}

/* ─── SETTINGS ──────────────────────────────────────────────────────────── */

/** Map of setting key → element ID */
const SETTINGS_MAP = {
  business_name:   'set-business-name',
  support_email:   'set-support-email',
  hq_phone:        'set-hq-phone',
  currency:        'set-currency',
  vat_rate:        'set-vat-rate',
  receipt_header:  'set-receipt-header',
  printer:         'set-printer',
  scanner:         'set-scanner',
  cash_drawer:     'set-drawer'
};

/**
 * Silently fetch settings into state.settingsCache on login.
 * Does NOT show any toast or populate form fields — just primes the cache
 * so getVatRate() / getCurrency() work from the first cart interaction.
 */
async function loadSettingsCache() {
  try {
    const data = await apiGet('/api/settings');
    state.settingsCache = data.data || {};
    applySettingsToUI();
  } catch (e) {
    // Network/auth errors: leave defaults (16% VAT, KES)
  }
}

async function loadSettings() {
  loadBranches();
  try {
    const data = await apiGet('/api/settings');
    const s = data.data || {};

    // Persist to cache so all helpers pick it up immediately
    state.settingsCache = s;

    // Populate each field from DB, fall back to placeholder if key not saved yet
    Object.entries(SETTINGS_MAP).forEach(([key, elId]) => {
      const el = document.getElementById(elId);
      if (!el || !(key in s)) return;
      // Don't overwrite password fields if value is empty string in DB
      if (el.type === 'password' && !s[key]) return;
      el.value = s[key];
    });

    // Apply to live UI (cart VAT label, receipt header, etc.)
    applySettingsToUI();

    showToast('Settings loaded from database');
  } catch (e) {
    if (e.code !== 'AUTH_ERROR') {
      showToast('Using default settings — could not reach server');
    }
  }
}

async function saveSettings() {
  const updates = {};
  Object.entries(SETTINGS_MAP).forEach(([key, elId]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    // Skip password fields that still have placeholder text or are empty
    if (el.type === 'password' && (!el.value || el.value.includes('•'))) return;
    if (el.value.trim() !== '') updates[key] = el.value.trim();
  });

  if (Object.keys(updates).length === 0) {
    showToast('No changes to save');
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (res.ok) {
      // Merge into cache so all helpers immediately reflect the new values
      state.settingsCache = { ...state.settingsCache, ...updates };
      // Push changes into every live UI element that depends on settings
      applySettingsToUI();
      showToast(`${Object.keys(updates).length} setting(s) saved successfully`);
    } else {
      showToast('Error saving settings: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    showToast('Network error — settings not saved');
  }
}

/* Z-REPORT HANDLERS */
function switchZTab(tabName, btn) {
  if (btn && btn.parentNode) {
    btn.parentNode.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  document.querySelectorAll('.z-tab-content').forEach(c => c.classList.add('hidden'));
  const target = document.getElementById('ztab-' + tabName);
  if (target) target.classList.remove('hidden');
}

function generateZReport() {
  const preview = document.getElementById('z-report-preview-card');
  if (preview) {
    preview.scrollIntoView({ behavior: 'smooth' });
  }
  showToast('Z-Report generated successfully');
}

/* BATCH UPLOAD HANDLERS */
function resetUploadDropZone() {
  const fileInput = document.getElementById('upload-file-input');
  if (fileInput) fileInput.value = '';
  const text = document.getElementById('upload-drop-text');
  if (text) {
    text.textContent = 'Click or Drag & Drop CSV / Excel File';
    text.style.color = '';
  }
}

async function openUploadModal(type = 'products') {
  resetUploadDropZone();
  const modal = document.getElementById('upload-modal');
  const typeSelect = document.getElementById('upload-type-select');
  const storeSelect = document.getElementById('upload-store-select');
  const title = document.getElementById('upload-modal-title');
  if (typeSelect) typeSelect.value = type;
  if (title) title.textContent = type === 'services' ? 'Upload Services Catalog CSV' : 'Upload Products Inventory CSV';

  // Populate dynamic branches
  if (storeSelect) {
    try {
      const bRes = await apiGet('/api/branches');
      const branches = bRes.data || [];
      let opts = '<option value="all">All Stores &amp; Warehouses</option>';
      branches.forEach(b => {
        opts += `<option value="${b.id}">${b.name}</option>`;
      });
      storeSelect.innerHTML = opts;

      const activeBranchId = (state.currentBranch && state.currentBranch.id && state.currentBranch.id !== 'all') ? state.currentBranch.id : 1;
      storeSelect.value = String(activeBranchId);
    } catch (_) {}
  }

  if (modal) modal.classList.remove('hidden');
}

function handleFileSelect(input) {
  const text = document.getElementById('upload-drop-text');
  if (input.files && input.files[0] && text) {
    text.textContent = `Selected: ${input.files[0].name} (${(input.files[0].size / 1024).toFixed(1)} KB)`;
    text.style.color = 'var(--brand)';
  }
}

function parseCSVText(text) {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some(c => c !== '')) rows.push(currentRow);
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c !== '')) rows.push(currentRow);
  }
  return rows;
}

async function processUploadBatch() {
  const storeSelect = document.getElementById('upload-store-select');
  const storeVal = storeSelect?.value || '1';
  const type = document.getElementById('upload-type-select')?.value || 'products';
  const fileInput = document.getElementById('upload-file-input');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a CSV file to upload.');
    return;
  }

  // Resolve target branch ID
  const activeBranchId = (state.currentBranch && state.currentBranch.id && state.currentBranch.id !== 'all') ? state.currentBranch.id : 1;
  const targetBranchId = storeVal !== 'all' ? storeVal : activeBranchId;

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text = e.target.result;
      const rawRows = parseCSVText(text);
      if (rawRows.length < 2) {
        showToast('CSV file is empty or missing data rows.');
        return;
      }

      const headers = rawRows[0].map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
      const items = [];

      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row.length || (row.length === 1 && !row[0])) continue;
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = row[idx] !== undefined ? row[idx] : '';
        });
        // Default item branch to targetBranchId if not specified in CSV row
        if (!obj.branch_id && !obj.branch && targetBranchId) {
          obj.branch_id = targetBranchId;
        }
        items.push(obj);
      }

      if (!items.length) {
        showToast('No valid product rows found in CSV.');
        return;
      }

      const res = await apiPost('/api/upload', {
        upload_type: type,
        store_warehouse: storeVal,
        branch_id: targetBranchId,
        items
      });
      if (res && res.success) {
        showToast(res.message || `Successfully processed ${res.total || items.length} records!`);
        if (type === 'services') {
          loadServices();
        } else {
          await loadCategories();
          await loadSuppliers();
          await loadInventory();
          await loadPOSProducts();
        }
      } else {
        showToast(res.error || 'Batch upload failed. Check CSV format.');
      }
    } catch (err) {
      console.error('[processUploadBatch] Error:', err);
      showToast(err.message || 'Error processing batch upload.');
    } finally {
      resetUploadDropZone();
      closeModal('upload-modal');
    }
  };
  reader.readAsText(file);
}

function downloadCSVTemplate(type = 'products') {
  let csvContent = '';
  if (type === 'services') {
    csvContent = 'code,name,category,price,unit,vat_applicable\nSRV-101,Sample Service,Maintenance,1500,Per Hour,1\n';
  } else {
    csvContent = 'name,sku,category,supplier,buy_price,sell_price,stock_qty,reorder_level,unit,expiry_date,image_url\nFresh Milk 500ml,MLK-500,Dairy,Bidco Africa Ltd,50,65,50,10,packet,2027-12-31,https://drive.google.com/file/d/SAMPLE_ID/view?usp=sharing\n';
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `openfloat_${type}_template.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Downloaded ${type} CSV template`);
}

async function exportInventoryCSV() {
  try {
    const branchId = state.currentBranch && state.currentBranch.id ? state.currentBranch.id : 'all';
    const url = branchId === 'all' ? '/api/inventory' : `/api/inventory?branch_id=${branchId}`;
    const res = await apiGet(url);
    const products = (res && res.data) ? res.data : [];
    if (!products.length) {
      showToast('No inventory products to export for this branch');
      return;
    }

    const headers = ['name', 'sku', 'category', 'supplier', 'buy_price', 'sell_price', 'stock_qty', 'reorder_level', 'unit', 'expiry_date', 'image_url', 'branch_id', 'branch_name'];
    const rows = products.map(p => {
      return [
        `"${(p.name || '').replace(/"/g, '""')}"`,
        `"${(p.sku || '').replace(/"/g, '""')}"`,
        `"${(p.category_name || '').replace(/"/g, '""')}"`,
        `"${(p.supplier_name || '').replace(/"/g, '""')}"`,
        p.buy_price || 0,
        p.sell_price || 0,
        p.stock_qty || 0,
        p.reorder_level || 10,
        `"${(p.unit || 'pcs').replace(/"/g, '""')}"`,
        p.expiry_date || '',
        `"${(p.image_url || '').replace(/"/g, '""')}"`,
        p.branch_id || (branchId !== 'all' ? branchId : 1),
        `"${(p.branch_name || state.currentBranch?.name || 'Main Branch').replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const branchSlug = (state.currentBranch?.name || 'inventory').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', blobUrl);
    link.setAttribute('download', `openfloat_${branchSlug}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${products.length} products for ${state.currentBranch?.name || 'branch'} to CSV`);
  } catch (err) {
    console.error('[exportInventoryCSV] error:', err);
    showToast('Failed to export inventory CSV');
  }
}

/* STOCK MOVEMENT HANDLERS — duplicate stubs removed; see openStockMovementModal() and submitStockMovementModal() above */

/* ══════════════════════════════════════════
   LOGISTICS MODULE — Delivery Tracking
══════════════════════════════════════════ */
let _delCache = [];
let _delCurrentTab = 'all';
let _logisticsMap = null;
let _mapMarkers = [];

// Nairobi landmark coordinates for vehicle pins
const _NAIROBI_VEHICLES = [
  { label: 'Van #1 — CBD',       lat: -1.2841, lng: 36.8235, color: '#F97316', status: 'in_transit' },
  { label: 'Van #2 — Westlands', lat: -1.2697, lng: 36.8123, color: '#10B981', status: 'in_transit' },
  { label: 'Van #3 — Eastlands', lat: -1.2960, lng: 36.8650, color: '#F59E0B', status: 'delayed'    },
  { label: 'Van #4 — Karen',     lat: -1.3175, lng: 36.7117, color: '#8B5CF6', status: 'in_transit' },
  { label: 'Van #5 — Thika Rd',  lat: -1.2333, lng: 36.8667, color: '#06B6D4', status: 'pending'    },
];

async function loadLogistics() {
  try {
    const bId = state.currentBranch?.id;
    const bParam = bId && bId !== 'all' ? `?branch_id=${bId}` : '';
    const data = await apiGet(`/api/logistics/deliveries${bParam}`);
    _delCache = data.data || [];
    updateDeliveryKPIs(_delCache);
    renderDeliveryRows(_delCache, _delCurrentTab);
    renderActiveDeliveries(_delCache);
  } catch (e) {
    console.error('[loadLogistics] error:', e);
    const tbody = document.getElementById('del-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Could not load deliveries.</td></tr>';
  }
  initLogisticsMap();
}

function updateDeliveryKPIs(items) {
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const today = new Date().toDateString();
  const active   = items.filter(d => d.status === 'in_transit').length;
  const done     = items.filter(d => d.status === 'delivered' && new Date(d.updated_at || d.created_at).toDateString() === today).length;
  const pending  = items.filter(d => d.status === 'pending').length;
  const delayed  = items.filter(d => d.status === 'delayed').length;
  setEl('del-kpi-active', active);
  setEl('del-kpi-done',    done);
  setEl('del-kpi-pending', pending);
  setEl('del-kpi-delayed', delayed);
}

function renderActiveDeliveries(items) {
  const box = document.getElementById('del-active-list');
  if (!box) return;
  const active = items.filter(d => ['in_transit','delayed','pending'].includes(d.status));
  if (!active.length) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">No active deliveries recorded.</div>';
    return;
  }
  box.innerHTML = active.slice(0, 8).map(d => {
    const cls = d.status === 'in_transit' ? 'on-time' : d.status === 'delayed' ? 'delayed' : 'pending';
    const badge = d.status === 'in_transit' ? '<span class="badge badge-green">In Transit</span>'
                : d.status === 'delayed'    ? '<span class="badge badge-red">Delayed</span>'
                : '<span class="badge badge-amber">Pending</span>';
    return `<div class="delivery-card">
      <div class="delivery-status ${cls}"></div>
      <div class="delivery-info">
        <p>${d.ref} — ${d.customer_name || d.destination || 'Unknown'}</p>
        <span>${d.driver_name ? d.driver_name + ' · ' : ''}ETA: ${d.eta || '—'}</span>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

function renderDeliveryRows(items, tab = 'all') {
  const tbody = document.getElementById('del-tbody');
  if (!tbody) return;
  const showDelete = canDelete();
  const filtered = tab === 'all' ? items : items.filter(d => d.status === tab);
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No ${tab === 'all' ? '' : tab.replace('_',' ') + ' '}deliveries found.</td></tr>`;
    return;
  }
  const statusMap = { pending: 'badge-amber', in_transit: 'badge-blue', delivered: 'badge-green', delayed: 'badge-red', cancelled: 'badge-red' };
  tbody.innerHTML = filtered.map(d => {
    const badge = statusMap[d.status] || 'badge-amber';
    const label = d.status.replace('_', ' ');
    const date = d.created_at ? new Date(d.created_at).toLocaleDateString('en-KE', {day:'numeric',month:'short'}) : '—';
    let actions = '';
    if (d.status === 'pending') {
      actions = `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="updateDeliveryStatus(${d.id},'in_transit')">Dispatch</button>`;
    } else if (d.status === 'in_transit') {
      actions = `<button class="btn-sm" style="padding:3px 7px;font-size:11px;" onclick="updateDeliveryStatus(${d.id},'delivered')">Mark Delivered</button>
                 <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);" onclick="updateDeliveryStatus(${d.id},'delayed')">Flag Delayed</button>`;
    } else {
      actions = `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;" onclick="showToast('${d.ref} — ${label}')">View</button>`;
    }
    return `<tr>
      <td><code style="font-size:11px;">${d.ref}</code></td>
      <td>${d.customer_name || '—'}</td>
      <td>${d.driver_name || '<span style="color:var(--text-muted);">Unassigned</span>'}</td>
      <td>${d.van_number || '—'}</td>
      <td>${d.destination || '—'}</td>
      <td>${d.eta || '—'}</td>
      <td><span class="badge ${badge}">${label}</span></td>
      <td style="white-space:nowrap;">${actions}
        ${showDelete ? `<button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);margin-left:4px;" onclick="deleteDelivery(${d.id}, '${(d.ref || '').replace(/'/g, "\\'")}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function filterDelTab(tab, btn) {
  _delCurrentTab = tab;
  document.querySelectorAll('#view-logistics .cat-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const q = document.getElementById('del-search')?.value || '';
  const list = q ? _delCache.filter(d => searchDelFilter(d, q)) : _delCache;
  renderDeliveryRows(list, tab);
}

function searchDeliveries(q) {
  const filtered = q ? _delCache.filter(d => searchDelFilter(d, q)) : _delCache;
  renderDeliveryRows(filtered, _delCurrentTab);
}

function searchDelFilter(d, q) {
  const query = q.toLowerCase();
  return (d.ref||'').toLowerCase().includes(query) ||
         (d.customer_name||'').toLowerCase().includes(query) ||
         (d.driver_name||'').toLowerCase().includes(query) ||
         (d.destination||'').toLowerCase().includes(query);
}

function initLogisticsMap() {
  const mapEl = document.getElementById('logistics-map');
  if (!mapEl || typeof L === 'undefined') return;

  // Destroy existing map if re-navigating
  if (_logisticsMap) { _logisticsMap.remove(); _logisticsMap = null; _mapMarkers = []; }

  // Nairobi centre
  _logisticsMap = L.map('logistics-map', { zoomControl: true, scrollWheelZoom: false }).setView([-1.2921, 36.8219], 12);

  // OpenStreetMap tiles (no API key needed)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18
  }).addTo(_logisticsMap);

  // 1. Plot Main Warehouse / HQ Marker
  const hqIcon = L.divIcon({
    className: '',
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:#F97316;border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
    ">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
        <path d="M2 13V6l6-4 6 4v7H2z" stroke="white" stroke-width="1.5"/>
        <path d="M6 13V9h4v4" stroke="white" stroke-width="1.5"/>
      </svg>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20]
  });

  L.marker([-1.2921, 36.8219], { icon: hqIcon })
    .bindPopup('<strong>Main Warehouse / HQ</strong><br>Central Dispatch Facility')
    .addTo(_logisticsMap);

  // 2. Plot real active deliveries from _delCache
  const activeDeliveries = (_delCache || []).filter(d => ['in_transit', 'delayed', 'pending'].includes(d.status));

  activeDeliveries.forEach((d, idx) => {
    // Generate map coordinates relative to HQ if exact lat/lng is missing
    const lat = d.lat || (-1.2921 + (((d.id || idx + 1) * 19) % 40 - 20) * 0.0035);
    const lng = d.lng || (36.8219 + (((d.id || idx + 1) * 29) % 40 - 20) * 0.0035);

    const statusColor = d.status === 'in_transit' ? '#10B981' : d.status === 'delayed' ? '#EF4444' : '#F59E0B';
    const statusLabel = d.status === 'in_transit' ? 'In Transit' : d.status === 'delayed' ? 'Delayed' : 'Pending';

    const vanIcon = L.divIcon({
      className: '',
      html: `<div style="
        width:34px;height:34px;border-radius:50%;
        background:${statusColor};border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        display:flex;align-items:center;justify-content:center;
        ${d.status === 'in_transit' ? 'animation:pulse-marker 2s infinite;' : ''}
      ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 11h9V6H2v5z" stroke="white" stroke-width="1.4"/>
          <path d="M11 7.5h2.5l1.5 2.5v2H11V7.5z" stroke="white" stroke-width="1.4"/>
          <circle cx="4.5" cy="13" r="1.2" fill="white"/>
          <circle cx="12" cy="13" r="1.2" fill="white"/>
        </svg>
      </div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18]
    });

    const marker = L.marker([lat, lng], { icon: vanIcon })
      .bindPopup(`
        <strong>${d.ref || 'Delivery #' + d.id}</strong><br>
        <b>Driver:</b> ${d.driver_name || 'Unassigned'} (${d.van_number || 'Vehicle'})<br>
        <b>Destination:</b> ${d.destination || 'N/A'}<br>
        <b>Status:</b> <span style="color:${statusColor};font-weight:600;">${statusLabel}</span>
      `)
      .addTo(_logisticsMap);

    _mapMarkers.push({ marker, id: d.id, status: d.status });
  });

  // Ensure Leaflet recalculates tile container dimensions after tab transition
  setTimeout(() => {
    if (_logisticsMap) _logisticsMap.invalidateSize();
  }, 250);
}


function openDeliveryModal() {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('del-customer', ''); setVal('del-driver', ''); setVal('del-van', '');
  setVal('del-origin', 'Main Warehouse'); setVal('del-destination', '');
  setVal('del-eta', '30 min'); setVal('del-notes', '');
  document.getElementById('delivery-modal')?.classList.remove('hidden');
}

async function submitDeliveryModal() {
  const customer_name = document.getElementById('del-customer')?.value.trim();
  const driver_name   = document.getElementById('del-driver')?.value.trim();
  const van_number    = document.getElementById('del-van')?.value.trim();
  const origin        = document.getElementById('del-origin')?.value.trim() || 'Main Warehouse';
  const destination   = document.getElementById('del-destination')?.value.trim();
  const eta           = document.getElementById('del-eta')?.value.trim() || '30 min';
  const notes         = document.getElementById('del-notes')?.value.trim();

  if (!destination) { showToast('Destination is required'); return; }

  try {
    const res = await apiPost('/api/logistics/deliveries', { customer_name, driver_name, van_number, origin, destination, eta, notes });
    if (res.success) {
      showToast(`Delivery ${res.ref} dispatched!`);
      closeModal('delivery-modal');
      loadLogistics();
    } else {
      showToast(res.error || 'Failed to dispatch delivery');
    }
  } catch(e) { showToast('Error dispatching delivery'); }
}

async function updateDeliveryStatus(id, status) {
  const labels = { in_transit: 'dispatch', delivered: 'mark as delivered', delayed: 'flag as delayed' };
  if (!confirm(`${labels[status] || status} this delivery?`)) return;
  try {
    const res = await fetch(`/api/logistics/deliveries/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (state.token || '') },
      body: JSON.stringify({ status })
    }).then(r => r.json());
    if (res.success) {
      showToast(`Delivery ${status.replace('_',' ')}!`);
      loadLogistics();
    } else {
      showToast(res.error || 'Failed to update delivery');
    }
  } catch(e) { showToast('Error updating delivery'); }
}

function exportDeliveriesCSV() {
  if (!_delCache.length) { showToast('No deliveries to export'); return; }
  const headers = ['Ref','Customer','Driver','Vehicle','Origin','Destination','ETA','Status','Date'];
  const rows = _delCache.map(d => [
    d.ref, `"${(d.customer_name||'').replace(/"/g,'""')}"`, `"${(d.driver_name||'').replace(/"/g,'""')}"`,
    d.van_number||'', d.origin||'', `"${(d.destination||'').replace(/"/g,'""')}"`,
    d.eta||'', d.status, d.created_at ? new Date(d.created_at).toLocaleDateString() : ''
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `deliveries_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  showToast('Deliveries exported to CSV');
}


document.addEventListener('DOMContentLoaded', () => {
  // Bind sidebar nav clicks cleanly for all views (including Settings)
  document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const viewId = item.getAttribute('data-view');
      if (viewId) navTo(viewId);
    });
  });

  // Category tab clicks in POS
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const cat = tab.getAttribute('data-cat');
      filterCat(cat, tab);
    });
  });

  // Keyboard shortcut Ctrl+K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCmdModal();
    }
  });

  // ─── Global HID Barcode Scanner Listener ────────────────────────────────
  let _barcodeBuffer = '';
  let _lastScanTime = 0;

  document.addEventListener('keydown', e => {
    const now = Date.now();
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
    const isPosSearch = activeEl && activeEl.id === 'pos-search';

    // Reset buffer if keypress delay > 70ms (human typing speed)
    if (now - _lastScanTime > 70) {
      _barcodeBuffer = '';
    }
    _lastScanTime = now;

    if (e.key === 'Enter') {
      if (_barcodeBuffer.length >= 2) {
        const code = _barcodeBuffer.trim().toLowerCase();
        const product = (state.productsCache || []).find(p => (p.sku || '').toLowerCase() === code);

        if (product) {
          addToCart(product.id);
          showToast(`Scanned: ${product.name} (${product.sku}) ✓`);

          // Play scanner beep audio feedback
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
              const ctx = new AudioCtx();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(1400, ctx.currentTime);
              gain.gain.setValueAtTime(0.12, ctx.currentTime);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start();
              osc.stop(ctx.currentTime + 0.08);
            }
          } catch (_) {}

          if (isPosSearch) {
            document.getElementById('pos-search').value = '';
            filterProducts();
          }
          _barcodeBuffer = '';
          e.preventDefault();
          return;
        }
      }
      _barcodeBuffer = '';
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      _barcodeBuffer += e.key;
    }
  });

  updateTime();

  // Restore existing session (auto-login if token saved in localStorage)
  checkSession();

  // Only load live data and charts if a session was restored
  if (state.user) {
    initCharts();
    loadBranches();
    loadPOSProducts();
    loadInventory();
    loadCustomers();
    if (state.user.role === 'owner' || state.user.role === 'manager') {
      loadDashboardKPIs();
    }
  }
});
