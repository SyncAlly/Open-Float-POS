# Sales History Per-Branch Isolation

## Root Cause
1. **Unscoped Frontend Sales History API Call:** In `loadSaleHistory()`, `apiGet('/api/sales/transactions')` was invoked without `?branch_id=`, which returned all transactions globally.
2. **Hardcoded Mock Fallback Data:** When an error or empty state was encountered, `loadSaleHistory()` fell back to demo mock transactions (`TXN-20260805-A101`, `Amina Khalid`, etc.) rather than properly reporting 0 transactions for empty branches.
3. **Backend `getTransactions` Scoping:** `getTransactions()` in `salesController.js` did not enforce branch locking for non-owner sessions and didn't handle `branch_id !== 'all'`.
4. **CSV Export Filename:** `exportSaleHistoryCSV()` saved files with generic names instead of reflecting the active branch.

---

## Fixes Implemented

### 1. Frontend Scope Enforcement ([`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js#L3720-L3755))
- **Active Branch Querying:** `loadSaleHistory()` now detects `state.currentBranch?.id` and calls `/api/sales/transactions?branch_id=${bId}&limit=500` (or consolidated HQ if in HQ overview mode).
- **Dynamic Modal Header:** Updated `#sh-modal-subtitle` to show:
  - `"Transactions for <Branch Name> · Filter sales performance and itemized receipts"`
  - `"All Branches (Enterprise HQ) Consolidated Sales History"` (when in HQ overview mode).
- **Removed Hardcoded Fallback Mock Data:** Empty branches now cleanly render empty states and 0 KPI counts (`sh-kpi-count`, `sh-kpi-revenue`, `sh-kpi-cash`, `sh-kpi-mpesa`).
- **Branch-Aware CSV Export:** `exportSaleHistoryCSV()` now names files as `sales_history_<branch_name>_<date>.csv`.
- **Purged on Branch Switch:** Added `txn-tbody` and `sh-kpi-*` clearing into `clearAllViewsDOM()`.

### 2. Backend Scoping ([`backend/controllers/salesController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/salesController.js#L98-L125))
- Updated `getTransactions()`:
  - If `req.user.role !== 'owner'`, automatically locks queries to `req.user.branch_id`.
  - Filters strictly with `WHERE t.branch_id = ?` when `branch_id && branch_id !== 'all'`.

---

## Automated Verification
An integration test (`test_sales_history.js`) verified:
- Freshly created branches start with **0 sales transactions**.
- Performing checkouts in the new branch creates transactions that are **only visible within that branch's sales history**.
- Main Branch sales history does **not** see or mix with other branches' sales records.
