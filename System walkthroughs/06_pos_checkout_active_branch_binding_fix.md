# POS Checkout Active Branch Binding Fix

## Root Cause
When the owner logged in, their user session had `user.branch_id = 1` (Main Branch).
1. In `processPayment()` in `js/app.js`, the `checkoutPayload` did not include the active branch ID (`state.currentBranch?.id`).
2. On the backend in `salesController.js`, `processCheckout()` defaulted the transaction's `branch_id` to `req.user.branch_id` (1).
3. Consequently, whenever the owner switched branches and completed a sale, the transaction was assigned to Main Branch (`branch_id = 1`) instead of the active branch.
4. When inspecting the active branch's sales history, it returned empty because the transaction was stored under Main Branch.

---

## Fixes Implemented

### 1. Frontend Checkout Payload ([`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js#L4296-L4325))
- In `processPayment()`, explicitly resolves:
  ```javascript
  const bId = state.currentBranch?.id;
  const targetBranchId = (bId && bId !== 'all') ? bId : (state.user?.branch_id || 1);
  ```
- Passes `branch_id: targetBranchId` in the `POST /api/sales/checkout` payload.

### 2. Backend Checkout Controller ([`backend/controllers/salesController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/salesController.js#L5-L95))
- In `processCheckout()`:
  - Resolves `finalBranchId = branch_id || inferredProductBranchId || (req.user ? req.user.branch_id : 1) || 1;`
  - Inferred branch fallback: If not passed, it reads `prod.branch_id` directly from the product being sold.
  - Automatically logs the sale in `stock_movements` under `finalBranchId` with the correct branch name.

---

## Verification
- Executed `test_owner_checkout.js` simulating an owner with default `branch_id = 1` switching to a newly created branch and processing a checkout.
- Verified:
  - Sale successfully recorded with `branch_id = 9`.
  - Transaction immediately returned in the active branch's sales history.
  - Transaction is **not** present in Main Branch sales history.
