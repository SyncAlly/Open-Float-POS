# Split-Second Flash of Previous Branch Data — Complete Resolution

## Root Cause Analysis
1. **Un-reset Background Views on Branch Switch:** When switching branches (`selectBranch()`), only the currently active view (e.g. Dashboard) was re-fetched. However, all other views (HR, CRM, Inventory, Sales POS, Logistics, Accounting, Hire Purchase, Receivables, etc.) in `index.html` retained the previous branch's rendered DOM elements (HTML table rows, lists, product grids, and KPI cards).
2. **DOM Visibility Preceding Data Fetch in `navTo()`:** When navigating between pages (`navTo(viewId)`), the target view was immediately rendered visible (`targetView.classList.add('active')`) before the asynchronous API fetch for the current branch resolved, causing the old branch's data to briefly flash on screen for a split second.
3. **Table & Container ID Discrepancies:** Key containers like `#inventory-tbody` (inventory), `#products-grid` (POS), `#sm-tbody` (stock movements), `#acc-ar-tbody`, `#acc-ap-tbody`, and all KPI text elements were not targeted by the earlier table reset logic.

---

## Changes Implemented

### 1. Global View DOM Reset Engine (`js/app.js`)
- Added `clearViewDOM(viewId)` and `clearAllViewsDOM()`:
  - **Tables:** Replaces table rows in `#inventory-tbody`, `#hr-tbody`, `#crm-tbody`, `#acc-je-tbody`, `#acc-ar-tbody`, `#acc-ap-tbody`, `#pr-tbody`, `#del-tbody`, `#sup-tbody`, `#hp-tbody`, `#ar-tbody`, `#srv-tbody`, `#sm-tbody`, `#txn-tbody`, `#comp-matrix-tbody` with clean loading spinner rows (`<tr class="view-loading-row"><td colspan="N"><span class="spinner-sm"></span> Loading ...</td></tr>`).
  - **Grids & Lists:** Replaces `#products-grid` (POS catalog), `#dash-txn-list`, `#dash-stock-list`, `#dash-branch-list`, `#dash-approvals-grid`, `#crm-top-customers`, `#del-active-list`, and `#z-report-preview` with loading skeleton boxes.
  - **All KPI Cards:** Immediately wipes all KPI values (`kpi-revenue`, `kpi-profit`, `hr-kpi-total`, `hr-kpi-payroll`, `inv-kpi-healthy`, `crm-kpi-total`, `acc-kpi-revenue`, `del-kpi-active`, `hp-kpi-active`, `ar-kpi-total`, etc.) to `'—'` (em-dash placeholder).

### 2. Pre-Render Clearing in `navTo()` (`js/app.js`)
- Added branch-state tracking (`state.viewLoadedBranch`):
  ```javascript
  const curBranchId = state.currentBranch?.id ?? '1';
  if (!state.viewLoadedBranch) state.viewLoadedBranch = {};
  if (state.viewLoadedBranch[viewId] !== curBranchId) {
    clearViewDOM(viewId);
  }
  ```
- Before any view is marked `.active` during page navigation, `navTo()` verifies if that view has already loaded fresh data for the active branch. If not, it wipes the view's DOM elements to loading skeletons **first**, ensuring zero old branch data is ever shown.

### 3. Immediate Purge in `selectBranch()` (`js/app.js`)
- `selectBranch()` wipes `state.viewLoadedBranch = {}`, resets all client cache arrays, calls `clearAllViewsDOM()` to purge the entire DOM across all views, and then triggers `triggerViewLoad(state.currentView)`.

### 4. Styles (`css/style.css`)
- Added `@keyframes spin`, `.spinner-sm`, and `.view-loading-row` / `.view-loading-box` CSS rules for smooth, instant visual feedback.

---

## Verification
- Confirmed full cache and DOM wipe when switching between branches and passing through every page (Dashboard, POS, Inventory, HR, CRM, Accounting, Procurement, Logistics, Suppliers, Hire Purchase, Receivables, Stock Movements, Services, Z-Reports).
- Verified with automated tests that data isolation and fresh branch zero-state remain 100% intact.
