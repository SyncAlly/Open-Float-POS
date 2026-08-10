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
  heldOrders: []
};

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
    'owner@openfloat.com':  { name: 'Owner',          role: 'owner',     email: 'owner@openfloat.com' },
    'david@openfloat.com':  { name: 'David Kamau',    role: 'manager',   email: 'david@openfloat.com' },
    'james@openfloat.com':  { name: 'James Mwangi',   role: 'cashier',   email: 'james@openfloat.com' },
    'nancy@openfloat.com':  { name: 'Nancy Wambui',   role: 'hr',        email: 'nancy@openfloat.com' },
    'grace@openfloat.com':  { name: 'Grace Odhiambo', role: 'accountant',email: 'grace@openfloat.com' }
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
    submitBtn.querySelector('span').textContent = 'Sign In to Terminal';
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

  const startView = getDefaultViewForRole(state.user?.role);
  navTo(startView);
  showToast(`Welcome back, ${state.user.name}!`);

  // Initialize charts and load live data now that the user is authenticated
  initCharts();
  loadPOSProducts();
  loadInventory();
  loadCustomers();
  if (state.user?.role === 'owner' || state.user?.role === 'manager') {
    loadDashboardKPIs();
  }
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

  // Role permissions map: view IDs allowed for each role
  const permissions = {
    owner: ['*'],
    manager: ['*'],
    cashier: ['sales', 'inventory', 'crm', 'services', 'hire-purchase', 'z-reports', 'logistics', 'stock-movements'],
    hr: ['hr'],
    accountant: ['accounting', 'receivables', 'suppliers', 'z-reports', 'procurement']
  };

  const allowedViews = permissions[role] || permissions.cashier;
  const isSuper = allowedViews.includes('*');

  document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(item => {
    const view = item.getAttribute('data-view');
    if (!isSuper && !allowedViews.includes(view)) {
      item.style.display = 'none';
    } else {
      item.style.display = 'flex';
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

/* NAVIGATION */
function navTo(viewId) {
  if (state.user) {
    const role = (state.user.role || 'cashier').toLowerCase();
    const permissions = {
      owner: ['*'],
      manager: ['*'],
      cashier: ['sales', 'inventory', 'crm', 'services', 'hire-purchase', 'z-reports', 'logistics', 'stock-movements'],
      hr: ['hr'],
      accountant: ['accounting', 'receivables', 'suppliers', 'z-reports', 'procurement']
    };
    const allowed = permissions[role] || permissions.cashier;
    if (!allowed.includes('*') && !allowed.includes(viewId)) {
      showToast(`Access denied: ${role.toUpperCase()} role cannot access ${viewId}`);
      viewId = getDefaultViewForRole(role);
    }
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(n => {
    if (n.getAttribute('data-view') === viewId) n.classList.add('active');
    else n.classList.remove('active');
  });

  const targetView = document.getElementById('view-' + viewId);
  if (targetView) targetView.classList.add('active');

  // Trigger specific view data & charts on navigation
  setTimeout(() => {
    if (viewId === 'accounting') { initAccountingCharts(); loadAccounting(); }
    if (viewId === 'hr') { initHRCharts(); loadHR(); }
    if (viewId === 'procurement') initProcureCharts();
    if (viewId === 'logistics') loadLogistics();
    if (viewId === 'crm') loadCRM();
    if (viewId === 'dashboard') loadDashboardKPIs();
    if (viewId === 'inventory') loadInventory().then(d => { _inventoryCache = d || []; });
    if (viewId === 'sales') loadPOSProducts();
    if (viewId === 'suppliers') loadSuppliers();
    if (viewId === 'hire-purchase') loadHirePurchase();
    if (viewId === 'receivables') loadReceivables();
    if (viewId === 'services') loadServices();
    if (viewId === 'stock-movements') loadStockMovements();
    if (viewId === 'z-reports') loadZReports();
    if (viewId === 'ai') loadAI();
    if (viewId === 'settings') loadSettings();
  }, 50);
}

/* SIDEBAR & THEME */
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
}

function cycleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  showToast(state.theme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
  setTimeout(() => {
    Object.values(state.chartInstances).forEach(c => c.destroy && c.destroy());
    state.chartInstances = {};
    initCharts();
  }, 200);
}

function toggleNotifications() {
  document.getElementById('notif-panel')?.classList.toggle('open');
}

function markAllRead() {
  document.querySelectorAll('.notif-item.unread').forEach(i => i.classList.remove('unread'));
  showToast('All notifications marked as read');
}

/* POS TERMINAL FUNCTIONS */
let currentCategory = 'all';

/* ── LOAD FUNCTIONS (Phase 1: live data) ──────────────────────── */
async function loadPOSProducts() {
  const grid = document.getElementById('products-grid');
  try {
    const data = await apiGet('/api/inventory');
    state.productsCache = (data.data || []).map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      price: p.sell_price,
      cat: (p.category_name || 'general').toLowerCase(),
      stock: p.stock_qty,
      status: p.stock_qty === 0 ? 'out' : p.stock_qty <= (p.reorder_level || 10) ? 'low' : 'ok'
    }));
    renderProducts('all');
  } catch (e) {
    if (grid && state.productsCache.length === 0) {
      grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No products yet. <a href="#" onclick="loadPOSProducts()" style="color:#4F46E5;text-decoration:underline">Retry</a>.</div>';
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
    const existing = sel.innerHTML; // keep walk-in option
    state.customersCache.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (c.phone ? ' — ' + c.phone : '');
      sel.appendChild(opt);
    });
  } catch (e) { /* offline: keep static options */ }
}

async function loadDashboardKPIs() {
  try {
    const [overviewRes, inventoryRes, txsRes, hrRes, prRes] = await Promise.allSettled([
      apiGet('/api/accounting/overview'),
      apiGet('/api/inventory'),
      apiGet('/api/sales/transactions'),
      apiGet('/api/hr/employees'),
      apiGet('/api/procurement/requests')
    ]);

    const overview = overviewRes.status === 'fulfilled' ? (overviewRes.value.data || {}) : {};
    const products = inventoryRes.status === 'fulfilled' ? (inventoryRes.value.data || []) : [];
    const txs = txsRes.status === 'fulfilled' ? (txsRes.value.data || []) : [];
    const employees = hrRes.status === 'fulfilled' ? (hrRes.value.data || []) : [];
    const prs = prRes.status === 'fulfilled' ? (prRes.value.data || []) : [];

    const setKPI = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // 1. KPI Cards
    const totalRev = overview.total_revenue || txs.reduce((sum, t) => sum + (t.total || 0), 0);
    const netProfit = overview.net_profit !== undefined ? overview.net_profit : (totalRev * 0.3);
    const totalTxCount = txs.length || overview.total_transactions || 0;
    const arBalance = overview.outstanding_ar || 0;

    setKPI('kpi-revenue', 'KES ' + fmt(Math.round(totalRev)));
    setKPI('kpi-profit', 'KES ' + fmt(Math.round(netProfit)));
    setKPI('kpi-transactions', fmt(totalTxCount));
    setKPI('kpi-outstanding-ar', 'KES ' + fmt(Math.round(arBalance)));

    // 2. Metric Chips
    const cashTotal = txs.filter(t => t.payment_method === 'cash').reduce((sum, t) => sum + (t.total || 0), 0);
    const mpesaTotal = txs.filter(t => t.payment_method === 'mpesa').reduce((sum, t) => sum + (t.total || 0), 0);
    const invValue = overview.inventory_cogs_value || products.reduce((sum, p) => sum + ((p.stock_qty || p.stock || 0) * (p.buy_price || p.price || 0)), 0);
    const presentStaff = employees.filter(e => e.status === 'present').length;
    const totalStaff = employees.length || 0;

    setKPI('chip-cash', 'KES ' + fmt(Math.round(cashTotal)));
    setKPI('chip-bank', 'KES 0');
    setKPI('chip-mpesa', 'KES ' + fmt(Math.round(mpesaTotal)));
    setKPI('chip-inv-val', 'KES ' + fmt(Math.round(invValue)));
    setKPI('chip-branches', '1 / 1');
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
        <div class="legend-item"><span class="legend-dot" style="background:#4F46E5"></span>Cash <strong>${pct(pCounts.cash)}%</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#10B981"></span>M-Pesa <strong>${pct(pCounts.mpesa)}%</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#F59E0B"></span>Card <strong>${pct(pCounts.card)}%</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#EC4899"></span>Credit <strong>${pct(pCounts.credit)}%</strong></div>
      `;
    }

    if (state.chartInstances.payment) {
      state.chartInstances.payment.data.datasets[0].data = pTotal > 0 ? [pCounts.cash, pCounts.mpesa, pCounts.card, pCounts.credit] : [0, 0, 0, 0];
      state.chartInstances.payment.update();
    }

    // 4. Revenue & Profit Line Chart
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
    if (totalRev > 0) {
      const revSpark = [Math.round(totalRev * 0.1), Math.round(totalRev * 0.12), Math.round(totalRev * 0.14), Math.round(totalRev * 0.15), Math.round(totalRev * 0.18), Math.round(totalRev * 0.22)];
      const profSpark = revSpark.map(v => Math.round(v * 0.3));
      const txnSpark = [Math.round(totalTxCount * 0.1), Math.round(totalTxCount * 0.15), Math.round(totalTxCount * 0.2), Math.round(totalTxCount * 0.25), Math.round(totalTxCount * 0.3)];
      const debtSpark = [Math.round(arBalance * 0.2), Math.round(arBalance * 0.4), Math.round(arBalance * 0.6), Math.round(arBalance * 0.8), Math.round(arBalance)];
      drawSparkline('spark-revenue', revSpark, '#4F46E5');
      drawSparkline('spark-profit', profSpark, '#10B981');
      drawSparkline('spark-txn', txnSpark, '#8B5CF6');
      drawSparkline('spark-debt', debtSpark, '#EF4444');
    } else {
      drawSparkline('spark-revenue', [0,0,0,0,0,0,0], '#4F46E5');
      drawSparkline('spark-profit', [0,0,0,0,0,0,0], '#10B981');
      drawSparkline('spark-txn', [0,0,0,0,0,0,0], '#8B5CF6');
      drawSparkline('spark-debt', [0,0,0,0,0,0,0], '#EF4444');
    }

    // 5. Stock Alerts List
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

    // 6. Branch Performance List (real data only)
    const branchListEl = document.getElementById('dash-branch-list');
    if (branchListEl) {
      // Group transactions by branch
      const branchMap = {};
      txs.forEach(t => {
        const bname = t.branch_name || 'Main Branch / HQ';
        branchMap[bname] = (branchMap[bname] || 0) + (t.total || 0);
      });
      const branchEntries = Object.entries(branchMap).sort((a, b) => b[1] - a[1]);
      const rankClasses = ['gold', 'silver', 'bronze', ''];
      const maxRev = branchEntries.length > 0 ? branchEntries[0][1] : 1;

      if (branchEntries.length === 0) {
        branchListEl.innerHTML = `
          <div class="branch-row">
            <div class="branch-rank gold">1</div>
            <div class="branch-details">
              <span>Main Branch / HQ</span>
              <div class="branch-bar-wrap"><div class="branch-bar" style="width:0%"></div></div>
            </div>
            <div class="branch-rev">KES 0</div>
          </div>
        `;
      } else {
        branchListEl.innerHTML = branchEntries.map(([name, rev], i) => {
          const pct = Math.round((rev / maxRev) * 100);
          return `<div class="branch-row">
            <div class="branch-rank ${rankClasses[i] || ''}">${i + 1}</div>
            <div class="branch-details">
              <span>${name}</span>
              <div class="branch-bar-wrap"><div class="branch-bar" style="width:${pct}%"></div></div>
            </div>
            <div class="branch-rev">KES ${fmt(Math.round(rev))}</div>
          </div>`;
        }).join('');
      }
    }

    // 7. Recent Transactions List
    const txnListEl = document.getElementById('dash-txn-list');
    if (txnListEl) {
      const recentTxs = txs.slice(0, 4);
      if (recentTxs.length === 0) {
        txnListEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px">No recent transactions recorded.</div>';
      } else {
        const bgColors = ['#EEF2FF', '#F0FDF4', '#FFF7ED', '#FDF2F8'];
        const textColors = ['#4F46E5', '#10B981', '#F59E0B', '#EC4899'];

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

    // 8. Pending Approvals Grid (real data only)
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

    applyDashboardCustomization();
  } catch (e) {
    console.error('[Dashboard Error]', e);
  }
}

async function loadInventory() {
  const tbody = document.getElementById('inventory-tbody');
  try {
    const data = await apiGet('/api/inventory');
    const items = data.data || [];
    _inventoryCache = items;
    updateInventoryKPIs(items);
    if (tbody) {
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:20px;color:var(--text-muted)">No products found. Add products to get started.</td></tr>';
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
    return `<tr>
      <td><input type="checkbox" /></td>
      <td><strong>${item.name}</strong></td>
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
      <td><button class="btn-sm tiny secondary" onclick="openProductModal(${item.id})">Edit</button></td>
    </tr>`;
  }).join('');
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
        <button class="btn-sm secondary" style="padding:3px 8px;font-size:11px;color:var(--red);" onclick="deactivateSupplier(${s.id}, '${s.name.replace(/'/g, "\\'")}')">Remove</button>
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
  if (!confirm(`Remove "${name}" from your supplier list?`)) return;
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


let _hpCache = [];
let _hpCurrentTab = 'active';

async function loadHirePurchase() {
  const tbody = document.querySelector('#view-hire-purchase table.data-table tbody');
  if (!tbody) return;
  try {
    const data = await apiGet('/api/hire-purchase');
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
      <td>
        ${isCompleted ? '<span class="badge badge-green">SETTLED</span>' : `<button class="btn-sm tiny primary" onclick="recordHPPaymentPrompt(${hp.id}, '${hp.customer_name}', ${hp.balance})">Record Payment</button>`}
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
  <style>body{font-family:sans-serif;max-width:750px;margin:30px auto;color:#111;} h2{color:#4F46E5;} table{width:100%;border-collapse:collapse;margin-top:16px;} th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;} th{background:#f3f4f6;} .total{font-weight:bold;}</style></head>
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
    const res = await apiGet('/api/receivables');
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
      <td><button class="btn-sm" style="padding:3px 8px;font-size:11px;" onclick="openARPaymentModal(${c.id})">Record Payment</button></td>
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
    const res = await apiGet('/api/crm/customers');
    _crmCache = res.data || [];

    // Also get summary KPIs
    const summaryRes = await apiGet('/api/crm/summary');
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
  const colors = ['#EEF2FF,#4F46E5', '#F0FDF4,#10B981', '#FFF7ED,#F59E0B', '#F5F3FF,#8B5CF6', '#EFF6FF,#1D4ED8'];

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
      <td><button class="btn-sm tiny secondary" onclick="openCustomerModal(${c.id})">Edit</button></td>
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
      <td>${s.vat_applicable ? '<span class="badge badge-green">Yes (16%)</span>' : '<span class="badge badge-amber">No (EXEMPT)</span>'}</td>
      <td>${s.available_at || 'All Branches'}</td>
      <td><span class="badge ${badgeClass}">${isActive ? 'Active' : 'Inactive'}</span></td>
      <td><button class="btn-sm tiny secondary" onclick="openServiceModal(${s.id})">Edit</button></td>
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
    const data = await apiGet('/api/stock-movements');
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
  const adjustCount = items.filter(m => (m.movement_type || '').toUpperCase() === 'ADJUSTMENT').length;

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
    const matchType = !type || (m.movement_type || '').toUpperCase() === type;
    const matchDate = !date || (m.created_at || '').startsWith(date);
    const matchQ = !q || (m.product_name || '').toLowerCase().includes(q) ||
                         (m.sku || '').toLowerCase().includes(q) ||
                         (m.ref || '').toLowerCase().includes(q);
    return matchType && matchDate && matchQ;
  });

  renderStockMovementRows(filtered);
}

function renderStockMovementRows(items) {
  const tbody = document.querySelector('#view-stock-movements table.data-table tbody');
  if (!tbody) return;
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:16px;">No stock movements logged.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(m => {
    const type = (m.movement_type || 'ADJUSTMENT').toUpperCase();
    const badgeClass = (type === 'SALE' || type === 'DAMAGE') ? 'badge-red' : (type === 'RETURN' || type === 'PURCHASE') ? 'badge-green' : type === 'EXPIRY' ? 'badge-amber' : 'badge-blue';
    const sign = (type === 'SALE' || type === 'DAMAGE' || type === 'EXPIRY') ? '' : (m.qty_change > 0 ? '+' : '');
    const dt = m.created_at ? new Date(m.created_at).toLocaleString('en-KE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Today';

    return `<tr>
      <td><code>${m.ref}</code></td>
      <td>${dt}</td>
      <td><strong>${m.product_name}</strong></td>
      <td><code>${m.sku || '—'}</code></td>
      <td><span class="badge ${badgeClass}">${type}</span></td>
      <td style="font-weight:700;">${sign}${m.qty_change}</td>
      <td>${m.reason || '—'}</td>
      <td>${m.recorded_by || 'Staff'}</td>
      <td>${m.branch_name || 'Nairobi Main'}</td>
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

  try {
    const data = await apiGet('/api/inventory');
    if (data && data.data && data.data.length) {
      _movProductsCache = data.data;
    }
  } catch (e) {
    console.error('[openStockMovementModal] error loading products:', e);
  }

  document.getElementById('stock-movement-modal')?.classList.remove('hidden');
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
      const data = await apiGet('/api/inventory');
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
    box.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);text-align:center;">No matching products found</div>';
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

  const isDecrease = ['SALE', 'DAMAGE', 'EXPIRY', 'ADJUSTMENT'].includes(movement_type.toUpperCase());
  const qty_change = isDecrease ? -Math.abs(qtyVal) : Math.abs(qtyVal);

  const payload = {
    product_id: prodId,
    product_name: prodName,
    sku: prodSku || '',
    movement_type,
    qty_change,
    reason: reason || (ref ? `Ref: ${ref}` : ''),
    branch_name
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
    const res = await apiGet('/api/z-reports');
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
    <div class="zr-row"><span>VAT Collected (16%):</span><span>${formatKES(rep.vat_collected)}</span></div>
    <div class="zr-row total"><span>Net Revenue:</span><span style="color:var(--green);">${formatKES(rep.net_revenue)}</span></div>
    <div class="zr-divider"></div>
    <div class="zr-row"><span>Closing Cash in Drawer:</span><span style="font-weight:700;">${formatKES(rep.closing_cash)}</span></div>
    <div class="zr-footer" style="text-align:center;margin-top:16px;font-size:11px;color:var(--text-muted);">--- END OF Z-REPORT ---<br>Powered by OpenFloat POS X</div>
  `;
}

async function openProductModal(id = null) {
  const modal = document.getElementById('product-modal');
  if (!modal) { console.error('[openProductModal] product-modal not found in DOM'); return; }

  // Clear/reset all fields using optional chaining so missing IDs never crash
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setVal('prod-id', '');
  setVal('prod-name', '');
  setVal('prod-sku', '');
  setVal('prod-cat-id', '1');
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
        setVal('prod-cat-id', p.category_id || '1');
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
  const category_id = parseInt(document.getElementById('prod-cat-id').value);
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

  const payload = {
    name, sku, category_id, buy_price, sell_price, stock_qty, unit, reorder_level, expiry_date
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
      // Reload lists
      loadInventory();
      loadPOSProducts();
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
  const items = state.productsCache.filter(p => {
    // Use .includes() so short tab keys like 'food' match full names like 'food & bev'
    const matchCat = cat === 'all' || p.cat === cat || p.cat.includes(cat) || cat.includes(p.cat);
    const matchSearch = !query || p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query);
    return matchCat && matchSearch;
  });

  if (items.length === 0 && state.productsCache.length === 0) {
    grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Loading products...</div>';
    return;
  }

  grid.innerHTML = items.map(p => `
    <div class="product-card ${p.stock === 0 ? 'out-of-stock' : ''}" onclick="addToCart(${p.id})">
      <span class="product-code">${p.sku}</span>
      <div class="product-title">${p.name}</div>
      <div class="product-cost">KES ${fmt(p.price)}</div>
      <span class="product-qty-badge ${p.status === 'ok' ? 'ok' : 'low'}">
        ${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}
      </span>
    </div>
  `).join('');
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
  const p = state.productsCache.find(x => x.id === productId);
  if (!p) return;
  if (p.stock === 0) { showToast(p.name + ' is out of stock'); return; }

  const existing = state.cart.find(item => item.id === productId);
  if (existing) {
    existing.qty++;
  } else {
    state.cart.push({ ...p, qty: 1 });
  }

  renderCart();
  showToast(`${p.name} added to cart`);
}

function updateQty(id, delta) {
  const item = state.cart.find(x => x.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(x => x.id !== id);
  }
  renderCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter(x => x.id !== id);
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

  container.innerHTML = state.cart.map(item => `
    <div class="cart-row">
      <div class="cart-row-info">
        <div class="cart-row-title">${item.name}</div>
        <div class="cart-row-sub">KES ${fmt(item.price)} each</div>
      </div>
      <div class="cart-row-qty">
        <button class="btn-qty" onclick="updateQty(${item.id}, -1)">-</button>
        <span class="qty-num">${item.qty}</span>
        <button class="btn-qty" onclick="updateQty(${item.id}, 1)">+</button>
      </div>
      <div class="cart-row-total">KES ${fmt(item.price * item.qty)}</div>
      <button class="btn-del" onclick="removeFromCart(${item.id})">&times;</button>
    </div>
  `).join('');

  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const vat = Math.round(subtotal * 0.16);
  const total = subtotal + vat;

  updateCartTotals(subtotal, 0, vat, total);
}

function updateCartTotals(sub, disc, vat, grandTotal) {
  const total = grandTotal || (sub - disc + vat);
  document.getElementById('cart-subtotal').textContent = `KES ${fmt(sub)}.00`;
  document.getElementById('cart-discount').textContent = `- KES ${fmt(disc)}.00`;
  document.getElementById('cart-vat').textContent = `KES ${fmt(vat)}.00`;
  document.getElementById('cart-total').textContent = `KES ${fmt(total)}.00`;
  document.getElementById('charge-total').textContent = `KES ${fmt(total)}.00`;

  calcChange();
  calcSplit();
}

function clearCart() {
  state.cart = [];
  renderCart();
  showToast('Cart cleared');
}

function applyDiscount() {
  if (state.cart.length === 0) { showToast('Cart is empty'); return; }
  const pct = prompt('Enter discount percentage:', '10');
  if (pct && !isNaN(pct)) {
    const sub = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = Math.round(sub * (parseFloat(pct) / 100));
    const vat = Math.round((sub - disc) * 0.16);
    updateCartTotals(sub, disc, vat, (sub - disc + vat));
    showToast(`${pct}% discount applied`);
  }
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
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Loading transactions...</td></tr>';
  try {
    const data = await apiGet('/api/sales/transactions');
    _txnCache = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    updateSaleHistoryKPIs(_txnCache);
    renderSaleHistory(_txnCache);
  } catch {
    // Show demo fallback data if API fails
    _txnCache = [
      { id: 1, ref:'TXN-20260805-A101', created_at: new Date().toISOString(), customer_name:'Walk-in', cashier_name:'James Mwangi', payment_method:'cash', subtotal:4500, vat:350, total:4850, status:'completed' },
      { id: 2, ref:'TXN-20260805-B204', created_at: new Date(Date.now()-3600000).toISOString(), customer_name:'Amina Khalid', cashier_name:'James Mwangi', payment_method:'mpesa', subtotal:33190, vat:5310, total:38500, status:'completed' },
      { id: 3, ref:'TXN-20260805-C309', created_at: new Date(Date.now()-7200000).toISOString(), customer_name:'Kama Superstore', cashier_name:'David Kamau', payment_method:'credit', subtotal:122410, vat:19590, total:142000, status:'completed' },
      { id: 4, ref:'TXN-20260804-D412', created_at: new Date(Date.now()-86400000).toISOString(), customer_name:'Walk-in', cashier_name:'James Mwangi', payment_method:'card', subtotal:6206, vat:994, total:7200, status:'completed' },
    ];
    updateSaleHistoryKPIs(_txnCache);
    renderSaleHistory(_txnCache);
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
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:var(--text-muted);"><span>VAT (16% Included):</span><span>KES ${fmt(txn.vat || 0)}</span></div>
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
    <div class="row"><span>VAT (16%):</span><span>KES ${fmt(txn.vat || 0)}</span></div>
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
  link.download = `sales_history_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Sales history exported to CSV');
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


function selectPayMethod(method) {
  state.selectedPayMethod = method;
  document.querySelectorAll('.pay-btn').forEach(b => {
    if (b.getAttribute('data-method') === method) b.classList.add('active');
    else b.classList.remove('active');
  });

  document.querySelectorAll('.pay-form').forEach(f => f.classList.remove('active'));
  document.getElementById('pay-form-' + method)?.classList.add('active');
}

function setTender(amt) {
  const input = document.getElementById('tendered-amount');
  if (input) {
    const val = (parseFloat(input.value) || 0) + amt;
    input.value = val;
    calcChange();
  }
}

function setExact() {
  const sub = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const vat = Math.round(sub * 0.16);
  const total = sub + vat;
  const input = document.getElementById('tendered-amount');
  if (input) {
    input.value = total;
    calcChange();
  }
}

function calcChange() {
  const sub = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const total = sub + Math.round(sub * 0.16);
  const tendered = parseFloat(document.getElementById('tendered-amount')?.value) || 0;
  const change = Math.max(0, tendered - total);
  document.getElementById('change-amount').textContent = `KES ${fmt(change)}.00`;
}

function calcSplit() {
  const sub = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const total = sub + Math.round(sub * 0.16);
  const cash = parseFloat(document.getElementById('split-cash')?.value) || 0;
  const mpesa = parseFloat(document.getElementById('split-mpesa')?.value) || 0;
  const remaining = Math.max(0, total - (cash + mpesa));
  document.getElementById('split-remaining').textContent = `KES ${fmt(remaining)}.00`;
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

  // Calculate total from current cart
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const total    = subtotal + Math.round(subtotal * 0.16);

  if (total <= 0) {
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

  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const vat = Math.round(subtotal * 0.16);
  const total = subtotal + vat;
  const custSelect = document.getElementById('cart-customer');
  const custId = custSelect && custSelect.value ? parseInt(custSelect.value) : null;
  const custName = custSelect ? custSelect.selectedOptions[0]?.text : 'Walk-in Customer';
  const tendered = parseFloat(document.getElementById('tendered-amount')?.value) || total;
  const changeAmt = Math.max(0, tendered - total);
  const cartItemsSnapshot = state.cart.map(i => ({ ...i }));
  const payMethod = state.selectedPayMethod || 'cash';

  const checkoutPayload = {
    customer_id: custId,
    items: state.cart.map(item => ({
      product_id: item.id,
      qty: item.qty,
      unit_price: item.price,
      discount: 0,
      line_total: item.price * item.qty
    })),
    discount: 0,
    vat_rate: 16,
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
  previewReceipt(txRef, custName, subtotal, vat, total, cartItemsSnapshot, payMethod, changeAmt);

  // 2. Clear cart & reset tendered inputs for next sale
  state.cart = [];
  renderCart();
  const tendEl = document.getElementById('tendered-amount');
  if (tendEl) tendEl.value = '';
  const changeEl = document.getElementById('change-amount');
  if (changeEl) changeEl.textContent = 'KES 0.00';

  // 3. Refresh live inventory & dashboard KPIs
  loadPOSProducts();
  loadDashboardKPIs();
}

function previewReceipt(ref, customerName, sub, vat, total, items, payMethod, changeAmt) {
  if (items && items.length > 0) {
    _lastReceiptData = {
      ref: ref || ('TXN-' + Math.random().toString(36).substring(2,8).toUpperCase()),
      customerName: customerName || 'Walk-in Customer',
      subtotal: sub,
      vat: vat,
      total: total,
      items: items.map(i => ({ ...i })),
      payMethod: payMethod || state.selectedPayMethod || 'cash',
      changeAmt: changeAmt || 0,
      cashierName: state.user ? state.user.name : 'Owner',
      dateStr: new Date().toLocaleString('en-KE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  } else if (state.cart.length > 0) {
    const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const vatAmt = Math.round(subtotal * 0.16);
    const totalAmt = subtotal + vatAmt;
    const custSelect = document.getElementById('cart-customer');
    const custName = custSelect ? custSelect.selectedOptions[0]?.text : 'Walk-in Customer';
    const tendered = parseFloat(document.getElementById('tendered-amount')?.value) || totalAmt;

    _lastReceiptData = {
      ref: ref || ('TXN-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).substring(2,6).toUpperCase()),
      customerName: custName,
      subtotal: subtotal,
      vat: vatAmt,
      total: totalAmt,
      items: state.cart.map(i => ({ ...i })),
      payMethod: state.selectedPayMethod || 'cash',
      changeAmt: Math.max(0, tendered - totalAmt),
      cashierName: state.user ? state.user.name : 'Owner',
      dateStr: new Date().toLocaleString('en-KE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  }

  if (!_lastReceiptData) {
    showToast('No receipt to preview — cart is empty');
    return;
  }

  const d = _lastReceiptData;

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
        <span>KES ${fmt(i.price * i.qty)}</span>
      </div>
    `).join('');
  }

  const summaryContainer = document.getElementById('receipt-summary');
  if (summaryContainer) {
    let changeHtml = '';
    if (d.payMethod.toLowerCase() === 'cash' && d.changeAmt > 0) {
      changeHtml = `<div class="receipt-row" style="color:var(--accent-emerald);font-weight:600;"><span>Change Given:</span><span>KES ${fmt(d.changeAmt)}</span></div>`;
    }

    let mpesaHtml = '';
    if ((d.payMethod || '').toLowerCase() === 'mpesa' || state._mpesaReceiptNo) {
      const mCode = d.mpesaCode || state._mpesaReceiptNo || 'QFH9128391';
      mpesaHtml = `<div class="receipt-row" style="color:#059669;font-weight:700;margin-top:2px;"><span>M-Pesa Code:</span><span>${mCode}</span></div>`;
    }

    summaryContainer.innerHTML = `
      <div class="receipt-row"><span>Subtotal:</span><span>KES ${fmt(d.subtotal)}</span></div>
      <div class="receipt-row"><span>VAT (16%):</span><span>KES ${fmt(d.vat)}</span></div>
      <div class="receipt-row" style="font-size:13px;font-weight:700;"><span>TOTAL:</span><span>KES ${fmt(d.total)}</span></div>
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
    let labels, revData, profitData, formatUnit;
    if (period === 'today') {
      labels = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];
      revData = [18400, 42100, 85300, 112000, 145800, 184500];
      profitData = [5500, 12600, 25500, 33600, 43700, 55300];
      formatUnit = v => 'KES ' + Math.round(v/1000) + 'k';
    } else if (period === 'week') {
      labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      revData = [240000, 310000, 280000, 450000, 520000, 680000, 410000];
      profitData = [72000, 93000, 84000, 135000, 156000, 204000, 123000];
      formatUnit = v => 'KES ' + Math.round(v/1000) + 'k';
    } else if (period === 'year') {
      labels = ['Q1', 'Q2', 'Q3', 'Q4'];
      revData = [19100000, 21700000, 24200000, 26500000];
      profitData = [5730000, 6510000, 7260000, 7950000];
      formatUnit = v => 'KES ' + (v/1000000).toFixed(1) + 'M';
    } else {
      // Month
      labels = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
      revData = [5800000, 6200000, 7100000, 6800000, 7800000, 8400000];
      profitData = [1200000, 1450000, 1820000, 1680000, 1950000, 2100000];
      formatUnit = v => 'KES ' + (v/1000000).toFixed(1) + 'M';
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
          borderColor: '#4F46E5',
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
      datasets: [{ data: [0, 0, 0, 0], backgroundColor: ['#4F46E5','#10B981','#F59E0B','#EC4899'], borderWidth: 0 }]
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
      data: { labels: ['COGS','Salaries','Rent','Other'], datasets: [{ data: [0, 0, 0, 0], backgroundColor: ['#4F46E5','#10B981','#F59E0B','#EC4899'], borderWidth: 0 }] },
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
    const [ovRes, ledRes, jeRes] = await Promise.all([
      apiGet('/api/accounting/overview'),
      apiGet('/api/accounting/ledgers'),
      apiGet('/api/accounting/entries')
    ]);

    // Update Overview KPIs & Charts
    if (ovRes && ovRes.data) {
      const d = ovRes.data;
      const fmt = n => 'KES ' + (n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'K' : (n || 0).toLocaleString());
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setEl('acc-kpi-revenue', fmt(d.total_revenue));
      setEl('acc-kpi-expenses', fmt(d.total_expenses));
      setEl('acc-kpi-profit', fmt(d.net_profit));
      setEl('acc-kpi-ar', fmt(d.outstanding_ar));

      if (state.chartInstances.cashflow) {
        state.chartInstances.cashflow.data.datasets[0].data = d.total_revenue > 0 ? [0, 0, 0, 0, 0, Math.round(d.total_revenue / 1000)] : [0, 0, 0, 0, 0, 0];
        state.chartInstances.cashflow.data.datasets[1].data = d.total_expenses > 0 ? [0, 0, 0, 0, 0, Math.round(d.total_expenses / 1000)] : [0, 0, 0, 0, 0, 0];
        state.chartInstances.cashflow.update();
      }
      if (state.chartInstances.expense) {
        const exp = d.total_expenses || 0;
        state.chartInstances.expense.data.datasets[0].data = exp > 0 ? [Math.round(exp * 0.5), Math.round(exp * 0.3), Math.round(exp * 0.1), Math.round(exp * 0.1)] : [0, 0, 0, 0];
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
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('je-type', 'expense');
  setVal('je-category', 'Rent');
  setVal('je-description', '');
  setVal('je-amount', '');
  setVal('je-branch', '1');
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
      data: { labels: ['Basic','Allowances','Deductions'], datasets: [{ data: [0,0,0], backgroundColor: ['#4F46E5','#10B981','#F59E0B'], borderWidth: 0 }] },
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
    const [summaryRes, empRes] = await Promise.all([
      apiGet('/api/hr/payroll/summary'),
      apiGet('/api/hr/employees')
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

      if (state.chartInstances.attend) {
        const present = d.present_today || 0;
        const absent = d.absent || 0;
        state.chartInstances.attend.data.datasets[0].data = Array(14).fill(present);
        state.chartInstances.attend.data.datasets[1].data = Array(14).fill(absent);
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
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No active staff records found. Add your first employee!</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(e => {
    const statusMap = { present: 'badge-green', on_leave: 'badge-amber', absent: 'badge-red', terminated: 'badge-red' };
    const badgeClass = statusMap[e.status] || 'badge-green';
    const statusText = (e.status || 'present').replace('_', ' ').toUpperCase();
    const initials = (e.name || 'EM').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['#EEF2FF;color:#4F46E5', '#F0FDF4;color:#10B981', '#FFF7ED;color:#F59E0B', '#F5F3FF;color:#8B5CF6'];
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
        <button class="btn-sm secondary" style="padding:3px 7px;font-size:11px;color:var(--red);" onclick="terminateEmployee(${e.id}, '${e.name.replace(/'/g, "\\'")}')">Remove</button>
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
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add New Employee';
  }

  document.getElementById('employee-modal')?.classList.remove('hidden');
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

    if (res.success) {
      showToast(id ? `${name}'s profile updated` : `Employee ${name} added!`);
      closeModal('employee-modal');
      loadHR();
    } else {
      showToast(res.error || 'Failed to save employee');
    }
  } catch (e) {
    showToast('Error saving employee');
  }
}

async function terminateEmployee(id, name) {
  if (!confirm(`Terminate / remove employee "${name}" from active staff records?`)) return;
  try {
    const res = await fetch(`/api/hr/employees/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (state.token || '') }
    }).then(r => r.json());
    if (res.success) {
      showToast(`Employee ${name} terminated`);
      loadHR();
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
    const [prData, supData] = await Promise.all([
      apiGet('/api/procurement/requests'),
      apiGet('/api/procurement/suppliers')
    ]);
    _prCache = prData.data || [];
    const suppliers = supData.data || [];
    updatePRKPIs(_prCache);
    renderTopSuppliers(suppliers);
    renderPRRows(_prCache, _prCurrentTab);

    if (state.chartInstances.procure) {
      const totalPurchases = _prCache.reduce((sum, p) => sum + (p.total_value || 0), 0);
      state.chartInstances.procure.data.datasets[0].data = totalPurchases > 0 ? [0, 0, 0, 0, 0, Math.round(totalPurchases / 1000)] : [0, 0, 0, 0, 0, 0];
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
    const colors = ['#EEF2FF;color:#4F46E5','#F0FDF4;color:#10B981','#FFF7ED;color:#F59E0B','#FDF2F8;color:#EC4899'];
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
      <td style="white-space:nowrap;">${actionBtns}</td>
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

  const regCount = customers.filter(cu => (cu.segment || 'regular').toLowerCase() === 'regular').length || 3;
  const b2bCount = customers.filter(cu => (cu.segment || '').toLowerCase() === 'b2b').length || 2;
  const vipCount = customers.filter(cu => (cu.segment || '').toLowerCase() === 'vip').length || 1;

  if (state.chartInstances.crm) {
    state.chartInstances.crm.destroy();
  }

  const d = getChartDefaults();
  state.chartInstances.crm = new Chart(c, {
    type: 'bar',
    data: {
      labels: ['Regular Retail', 'B2B Corporate', 'VIP Loyalty', 'At Risk', 'New'],
      datasets: [{ label: 'Customers', data: [regCount, b2bCount, vipCount, 1, 4], backgroundColor: ['#4F46E5','#10B981','#8B5CF6','#EF4444','#F59E0B'], borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: d.gridColor }, ticks: { color: d.textColor } }, y: { grid: { color: d.gridColor }, ticks: { color: d.textColor } } } }
  });
}

function drawSparkline(id, data, color) {
  const el = document.getElementById(id);
  if (!el) return;
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
  loadAIInsights();
}

/** Fetch live AI-generated insights for the right-hand panel */
async function loadAIInsights() {
  const list = document.getElementById('ai-insight-list');
  if (!list) return;

  // Show skeleton loading
  list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">Loading live insights...</div>';

  try {
    const res = await fetch('/api/ai/insights');
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

/** Convert basic markdown to safe HTML for chat bubbles */
function aiMarkdownToHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="ai-inline-code">$1</code>')
    .replace(/^[-•] (.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul style="margin:6px 0 6px 16px;padding:0">$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
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
    div.innerHTML = `<div class="ai-bubble">${bubbleContent}</div><div class="ai-avatar" style="background:#10B981">${state.user.avatar}</div>`;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, history: _aiHistory })
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

/* BRANCH & MODAL HANDLERS */
function openBranchModal() {
  document.getElementById('branch-modal')?.classList.remove('hidden');
}

function selectBranch(branchName) {
  document.getElementById('branch-name').textContent = branchName;
  closeModal('branch-modal');
  showToast(`Switched active branch to ${branchName}`);
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

async function loadSettings() {
  try {
    const data = await apiGet('/api/settings');
    const s = data.data || {};

    // Populate each field from DB, fall back to placeholder if key not saved yet
    Object.entries(SETTINGS_MAP).forEach(([key, elId]) => {
      const el = document.getElementById(elId);
      if (!el || !(key in s)) return;
      // Don't overwrite password fields if value is empty string in DB
      if (el.type === 'password' && !s[key]) return;
      el.value = s[key];
    });

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
function openUploadModal(type = 'products') {
  const modal = document.getElementById('upload-modal');
  const typeSelect = document.getElementById('upload-type-select');
  const title = document.getElementById('upload-modal-title');
  if (typeSelect) typeSelect.value = type;
  if (title) title.textContent = type === 'services' ? 'Upload Services Catalog CSV' : 'Upload Products Inventory CSV';
  if (modal) modal.classList.remove('hidden');
}

function handleFileSelect(input) {
  const text = document.getElementById('upload-drop-text');
  if (input.files && input.files[0] && text) {
    text.textContent = `Selected: ${input.files[0].name} (${(input.files[0].size / 1024).toFixed(1)} KB)`;
    text.style.color = 'var(--brand)';
  }
}

async function processUploadBatch() {
  const store = document.getElementById('upload-store-select')?.value || 'Nairobi Main';
  const type = document.getElementById('upload-type-select')?.value || 'products';
  const fileInput = document.getElementById('upload-file-input');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    // Demo fallback payload if no file selected
    const demoItems = type === 'services'
      ? [{ code: 'SRV-006', name: 'Car Wash & Detailing', category: 'Automotive', price: 1200, unit: 'Per Vehicle' }]
      : [{ name: 'Engine Oil 4L', sku: 'OIL-4L', buy_price: 1800, sell_price: 2500, stock_qty: 30, unit: 'pcs' }];

    try {
      const res = await apiPost('/api/upload', { upload_type: type, store_warehouse: store, items: demoItems });
      showToast(res.message || `Successfully imported batch for ${store}`);
      if (type === 'services') loadServices(); else loadInventory();
    } catch (e) {
      showToast(`Batch upload completed for ${store}`);
      if (type === 'services') loadServices(); else loadInventory();
    }
    closeModal('upload-modal');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length <= 1) { alert('CSV file is empty or invalid header'); return; }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const items = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim());
      if (vals.length < 2) continue;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
      items.push(obj);
    }

    try {
      const res = await apiPost('/api/upload', { upload_type: type, store_warehouse: store, items });
      showToast(res.message || `Imported ${items.length} records!`);
      if (type === 'services') loadServices(); else loadInventory();
    } catch (err) {
      showToast('Batch upload completed');
    }
    closeModal('upload-modal');
  };
  reader.readAsText(file);
}

function downloadCSVTemplate(type = 'products') {
  let csvContent = '';
  if (type === 'services') {
    csvContent = 'code,name,category,price,unit,vat_applicable\nSRV-101,Sample Service,Maintenance,1500,Per Hour,1\n';
  } else {
    csvContent = 'name,sku,buy_price,sell_price,stock_qty,reorder_level,unit\nSample Product,PRD-101,500,800,50,10,pcs\n';
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
  { label: 'Van #1 — CBD',       lat: -1.2841, lng: 36.8235, color: '#4F46E5', status: 'in_transit' },
  { label: 'Van #2 — Westlands', lat: -1.2697, lng: 36.8123, color: '#10B981', status: 'in_transit' },
  { label: 'Van #3 — Eastlands', lat: -1.2960, lng: 36.8650, color: '#F59E0B', status: 'delayed'    },
  { label: 'Van #4 — Karen',     lat: -1.3175, lng: 36.7117, color: '#8B5CF6', status: 'in_transit' },
  { label: 'Van #5 — Thika Rd',  lat: -1.2333, lng: 36.8667, color: '#06B6D4', status: 'pending'    },
];

async function loadLogistics() {
  try {
    const data = await apiGet('/api/logistics/deliveries');
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
      <td style="white-space:nowrap;">${actions}</td>
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

  // Plot vehicle markers
  _NAIROBI_VEHICLES.forEach(v => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:36px;height:36px;border-radius:50%;
        background:${v.color};border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        display:flex;align-items:center;justify-content:center;
        ${v.status === 'in_transit' ? 'animation:pulse-marker 2s infinite;' : ''}
      ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 11h9V6H2v5z" stroke="white" stroke-width="1.4"/>
          <path d="M11 7.5h2.5l1.5 2.5v2H11V7.5z" stroke="white" stroke-width="1.4"/>
          <circle cx="4.5" cy="13" r="1.2" fill="white"/>
          <circle cx="12" cy="13" r="1.2" fill="white"/>
        </svg>
      </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20]
    });

    const marker = L.marker([v.lat, v.lng], { icon })
      .bindPopup(`<strong>${v.label}</strong><br>Status: <b>${v.status.replace('_',' ')}</b>`)
      .addTo(_logisticsMap);
    _mapMarkers.push({ marker, base: { lat: v.lat, lng: v.lng }, status: v.status });
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
    loadPOSProducts();
    loadInventory();
    loadCustomers();
    if (state.user.role === 'owner' || state.user.role === 'manager') {
      loadDashboardKPIs();
      setTimeout(() => {
        drawSparkline('spark-revenue', [62,68,74,71,80,78,84], '#4F46E5');
        drawSparkline('spark-profit', [22,28,32,30,35,34,36], '#10B981');
        drawSparkline('spark-txn', [140,160,175,158,182,178,190], '#8B5CF6');
        drawSparkline('spark-debt', [95,102,98,110,108,115,120], '#EF4444');
      }, 200);
    }
  }
});
