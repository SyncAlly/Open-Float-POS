# Settings & Branch Management Access Control (Owner-Exclusive)

## Overview
Restricted branch creation, deactivation, and enterprise-wide settings strictly to the **Business Owner**, removing administrative privileges from Branch Managers while preserving local register hardware configuration.

---

## Key Changes Implemented

### 1. Backend Route & Controller Protection ([`branches.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/routes/branches.js), [`branchController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/branchController.js))
- Locked `POST /api/branches`, `PUT /api/branches/:id`, and `DELETE /api/branches/:id` to `requireRole('owner')`.
- Added defense-in-depth role assertions in `createBranch`, `updateBranch`, and `deleteBranch` returning `403 Forbidden` if invoked by non-owners.

### 2. Frontend UI Separation ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html), [`app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js))
- **Owner View:**
  - Full access to `+ Add Branch` button and branch deletion.
  - Full editing rights on Business Profile, Tax & VAT, Currency, and Hardware.
  - "Save Changes" updates the global server settings.
- **Manager View:**
  - `+ Add Branch` button is completely hidden from the UI.
  - `openAddBranchModal()` has an explicit JavaScript role guard blocking unauthorized calls.
  - Enterprise fields (Business Name, Support Email, Phone, Currency, VAT rate, Receipt Header) are disabled as read-only with a tooltip.
  - Hardware & Devices (Thermal Printer, Scanner, Cash Drawer) remains active and saves per-workstation settings to browser storage.

---

## Verification Results
Executed automated RBAC verification test (`scratch/test_settings_rbac.js`):
- Manager `POST /api/branches` $\rightarrow$ `403 Forbidden` (Passed)
- Manager `DELETE /api/branches/1` $\rightarrow$ `403 Forbidden` (Passed)
- Manager `PUT /api/settings` $\rightarrow$ `403 Forbidden` (Passed)
- Owner `PUT /api/settings` $\rightarrow$ `200 OK` (Passed)
