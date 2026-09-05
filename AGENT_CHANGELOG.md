# OpenFloat POS X - Shared Agent Change Log

This file is the shared memory log for the project. It is intended to help both human developers and AI agents understand what has changed in the system, what is currently in progress, and what is known about the codebase.

Rules:
- Keep this file updated whenever a meaningful change is made.
- Do not delete historical entries; append new ones.
- Include date, summary, scope, and notes about validation or risk.
- If a change affects security, database, auth, payments, sales, inventory, or user access, clearly note it.
- If a change is speculative or unverified, label it as such.

## Current Project Baseline
- Project: OpenFloat POS X
- Stack: Node.js + Express + SQLite + vanilla HTML/CSS/JS
- Primary backend entry: `backend/server.js`
- Primary frontend entry: `index.html` and `js/app.js`
- Security baseline reviewed on 2026-08-31

## Change Log

### 2026-08-31 | Baseline review and project memory note
- Scope: Documentation and architecture review only
- Summary: Reviewed project structure, backend routes, auth flow, and database layer to understand the system and identify security/database concerns.
- Notes:
  - No source files were modified during this review.
  - This file was created to serve as persistent shared memory for future AI agents and collaborators.
  - Main areas reviewed: backend server, auth middleware and controller, database schema, M-Pesa controller, seed/reset scripts, and project docs.
  - Important findings already noted: fallback JWT secret risk, default password and M-Pesa defaults, weak password policy, missing advanced security headers, SQLite suitability concerns for production scale.

## Agent Update Template
Use the format below for all future entries:

### YYYY-MM-DD | Short Title
- Scope: Module or system area changed
- Summary: What was changed
- Files affected: list the relevant files
- Validation: what was checked or tested
- Risk / Notes: any caveats, dependencies, or follow-ups

## Important Working Notes
- This file is the shared source of truth for cross-agent memory.
- If a change is made outside this log, it should be added here as soon as practical.
- This project is a business system handling sales, payroll, inventory, customer credit, and M-Pesa flows; security and database integrity must be treated carefully.


### 2026-08-31 | Hardened auth and server security
- Scope: Authentication, backend security headers, password validation, environment config, and default secrets
- Summary: Added safer JWT secret handling, stronger password rules, Helmet security headers, env-based CORS configuration, and stronger default credentials for seeded/admin flows. Also prevented production usage of blank M-Pesa credentials and restricted demo tokens to non-production mode.
- Files affected: backend/server.js, backend/middleware/auth.js, backend/controllers/authController.js, backend/utils/security.js, backend/db/seed.js, backend/db/clean_reset.js, backend/controllers/mpesaController.js, .env.example
- Validation: Node syntax checks were run on the updated backend files.
- Risk / Notes: In production, JWT_SECRET, ALLOWED_ORIGINS, and M-Pesa credentials must be set explicitly in the environment; the app will fail fast if required security values are missing.

### 2026-09-01 | Reverted login console shape change
- Scope: Login page visual design
- Summary: Reverted the temporary circular login card experiment and restored the original rectangular glass-style login panel to match the established layout and styling.
- Files affected: css/style.css
- Validation: Verified the login card styling matches the previous rectangular version while retaining the existing design language.
- Risk / Notes: This is a cosmetic revert only; no app logic or auth flow was changed.

### 2026-09-02 | Branch-scoped logistics, terminal clock-in lock, and receipt timestamp synchronization
- Scope: Logistics fleet tracking, POS Sales terminal, HR shift attendance, and Receipt timestamping
- Summary: 
  - Scoped live Leaflet delivery pins and dispatch hub labels strictly to the active branch (with consolidated enterprise overview retained for Owner).
  - Enforced Time & Attendance guard so cashiers must be clocked in with an active shift before completing sales terminal transactions (enforced both in frontend UI and backend API).
  - Synchronized transaction timestamps between backend and frontend receipts to eliminate timezone discrepancies and guarantee that printed and modal receipts display the exact moment the sale took place.
- Files affected: js/app.js, index.html, backend/controllers/logisticsController.js, backend/controllers/salesController.js
- Validation: Verified frontend and backend syntax, validated clock-in guard and date formatting logic.
- Risk / Notes: Cashiers without an open shift will receive an HTTP 403 response if attempting to checkout via direct API calls.

### 2026-09-03 | Comprehensive backend security audit and vulnerability remediation
- Scope: Static file exposure, Settings credential masking, RBAC authorization, Privilege escalation, and SSRF/XSS defenses
- Summary:
  - Blocked directory traversal & public static exposure of backend sources, databases (`.sqlite`), configuration (`.env`), and dependencies (`package.json`) in Express static serving.
  - Added credential redaction in Settings API: masked M-Pesa secrets, API keys, and SMTP passwords for non-owner roles, and blocked non-owner direct key retrieval.
  - Mitigated privilege escalation in user registration/upsert: non-owner users can no longer assign the `owner` role or modify owner accounts.
  - Enforced strict RBAC across unshielded routes: Accounting ledgers/entries, Procurement PR status approvals, M-Pesa payments audit list, Supplier mutations, Service mutations, Stock movement creation, Z-Report generation, and Batch uploads now strictly require `owner` or `manager` roles.
  - Hardened image downloader against SSRF (blocked loopback, private RFC1918 IPs, and cloud metadata endpoints), disallowed `.svg` to prevent stored XSS, and enforced a 10MB buffer limit to prevent DoS.
- Files affected: backend/server.js, backend/controllers/settingsController.js, backend/controllers/authController.js, backend/utils/imageDownloader.js, backend/routes/accounting.js, backend/routes/procurement.js, backend/routes/mpesa.js, backend/routes/suppliers.js, backend/routes/services.js, backend/routes/stockMovements.js, backend/routes/zReports.js, backend/routes/upload.js
- Validation: Ran node sanity and compilation checks across all modified backend controllers and routers; confirmed clean server startup and RBAC enforcement.
- Risk / Notes: Non-owner roles attempting to access administrative endpoints or view payment secrets will now receive standard 403 Forbidden responses.

### September 2026 - HQ HR Management Enhancements
- **HR Overview Modification:** Modified the getEmployees backend controller to dynamically UNION owner accounts from the users table into the returned list when requested by an owner.
- **Owner Password Management UI:** Updated the HR table rendering in pp.js to detect owner accounts (is_owner_user = 1) and replace the 'Edit'/'Pay Stub'/'Delete' buttons with a dedicated 'Change Password' button. This allows the business owner to change system owner credentials directly from the HR overview without needing an underlying employees table record.

- **Employee & Owner Credential Editing:** Updated the Employee Modal to pre-fill the Login Email and display dummy asterisks ('********') in the Password field if the employee already has login credentials. This replaces the confusing blank space. Reverted the owner HR row to use the standard 'Edit' button (allowing owners to be edited via the same Employee Modal). Handled owner ID interception in hrController.js to update the users table directly without requiring an employees table record.


### 2026-09-04 | Dynamic Role & Permissions Builder in Enterprise HQ Overview
- Scope: Custom roles management, fine-grained view access control, backend RBAC resolution, and staff role assignment
- Summary:
  - Added `custom_roles` table schema and migration in `backend/db/database.js` with seeded system defaults (Manager, Cashier, HR Officer, Accountant).
  - Created `backend/controllers/rolesController.js` and `backend/routes/roles.js` with full CRUD operations protected by Owner-only authorization. System roles are protected against modification or deletion.
  - Updated `backend/middleware/rbac.js` with asynchronous role resolution: custom roles map to a backend trust level (`base_role`) ensuring zero API security bypass.
  - Added 'Roles & Access' tab to the Enterprise HQ Overview (`view-branch-comparison`) in `index.html`.
  - Designed interactive role cards grid displaying trust levels, active module access badges, and management actions (Edit/Delete for custom roles, Protected for core roles).
  - Added Role Create/Edit modal with customizable module access checkboxes (Sales, Services, CRM, HP, Inventory, Stock Movements, Procurement, Logistics, Accounting, Receivables, Suppliers, Z-Reports, HR, AI).
  - Updated `applyRolePermissions()` in `js/app.js` to dynamically filter sidebar navigation items according to the assigned custom role's permissions.
  - Updated `openEmployeeModal()` to dynamically populate the System Role dropdown with all active custom roles alongside system defaults.
- Files affected: backend/db/database.js, backend/controllers/rolesController.js, backend/routes/roles.js, backend/server.js, backend/middleware/rbac.js, index.html, js/app.js
- Validation: Verified compilation and syntax for all files; tested GET, POST, PUT, DELETE /api/roles endpoints, confirmed 403 enforcement on system roles, and verified clean server operation.


- **Walkthrough Archival Policy:** Created System walkthroughs/ directory in the project root to permanently archive feature walkthroughs. Saved the Dynamic Role & Permissions Builder walkthrough to System walkthroughs/dynamic_role_and_permissions_builder.md and System walkthroughs/walkthrough.md. All future walkthroughs will be stored here.


### 2026-09-04 | Dedicated Roles & Access Page under Enterprise HQ
- Scope: Navigation hierarchy, standalone view isolation, and HQ workspace organization
- Summary:
  - Extracted the Roles & Access feature out of the Multi-Branch Performance Comparison tab bar and promoted it into its own standalone view (`view-roles`) under the Enterprise HQ sidebar section.
  - Added a dedicated sidebar navigation item `nav-roles` featuring a shield access icon and `HQ` badge.
  - Added 4 high-level KPI cards to the Roles & Access page (Total Roles, Custom Roles, Core Protected Roles, Security Protocol).
  - Restored Multi-Branch Performance Comparison (`view-branch-comparison`) to its 4 core operational analytics tabs (Sales & Revenue, Staff & Productivity, Inventory & Stock, Payment Channels).
  - Archived full technical walkthrough to `System walkthroughs/18_roles_and_access_dedicated_enterprise_hq_page.md` and refreshed `INDEX.md`.
- Files affected: index.html, js/app.js, AGENT_CHANGELOG.md, System walkthroughs/18_roles_and_access_dedicated_enterprise_hq_page.md, System walkthroughs/INDEX.md

## [2026-09-05] - Dedicated Print-Optimized Branch Comparison Report & PDF Export

### Added
- **Dedicated Executive Report Container (`#branch-comparison-report`)**: Added a print-only report container in `index.html` designed specifically for formal PDF generation, auditing, and printouts instead of capturing raw on-screen dashboard viewports.
- **Dynamic Report Generator (`exportBranchComparisonReport()`)**: Implemented in `js/app.js` to compile live comparison metrics into a structured executive document:
  - **Corporate Header & Metadata**: Enterprise branding, dynamic document reference number (`BCR-...`), active timeframe, generation timestamp, authorized officer credentials, and active branch scope.
  - **Executive KPI Summary**: Grid containing consolidated enterprise revenue, top revenue-generating branch with percentage share, total workforce headcount with average attendance rate, and total inventory holding valuation with active low-stock alerts.
  - **Visual Comparative Analytics**: High-resolution chart snapshots exported via `.toDataURL('image/png')` for both multi-branch comparative metrics and contribution donut distributions, preventing blank canvas rendering or browser layout distortions during print.
  - **Comprehensive Multi-Store Benchmarking Matrix**: Full tabular matrix showing branch rankings, store name, location, revenue, revenue share %, order volume, average order value (AOV), staff headcount, attendance %, inventory valuation, and tiered performance badges, complete with enterprise totals/averages footer row.
  - **Executive Observations & Notes**: Auto-generated business insights highlighting revenue leadership, operational volume, staffing health, and inventory replenishment priorities.
  - **Formal Sign-off & Audit Trail**: Included dedicated signature blocks for Operations/Audit Lead and Managing Director/Owner, with confidentiality notice and pagination metadata.

### Changed
- **Export Report Action**: Updated the "Export Report" button in `index.html` (`#view-branch-comparison`) to trigger `exportBranchComparisonReport()` instead of raw unformatted `window.print()`.
- **Print Stylesheet Optimization**: Scoped `@media print` in `css/style.css` to render `#branch-comparison-report` with strict multi-page layout rules (`break-inside: avoid`, clear table borders, grayscale-safe contrasts, and suppressed dashboard UI chrome).
- **Files Affected**: `index.html`, `js/app.js`, `css/style.css`, `AGENT_CHANGELOG.md`.

### 2026-09-05 | Input Schema Validation, String Bounding & Recursive XSS Sanitization
- Scope: Backend API Security, Input Sanitization, Request Validation Layer (All API routes)
- Summary:
  - Implemented comprehensive input validation and XSS defense-in-depth across the entire backend using Joi v17.
  - Built `backend/utils/sanitizer.js` with iterative HTML/script tag stripping (`scrubHtml`), whitespace trimming, length-bounding, and recursive object/array traversal (`sanitizeValue`), protecting password/secret fields from tag corruption.
  - Mounted global Express middleware `sanitizeRequest` in `backend/server.js` to automatically sanitize all incoming `req.body`, `req.query`, and `req.params`.
  - Built `backend/middleware/validation.js` leveraging a custom Joi extension that enforces string trimming, length bounds, HTML tag scrubbing, and unknown field stripping across API routes.
  - Wired validation schemas across all core modules:
    - Auth: `login`, `register`, `change-password`
    - Inventory: `createProduct`, `updateProduct`, `stockAdjustment`
    - Sales: `checkout`
    - CRM: `createCustomer`, `updateCustomer`
    - Suppliers: `createSupplier`, `updateSupplier`
    - Services: `createService`, `updateService`
    - Roles & RBAC: `createRole`, `updateRole`
    - Branches: `createBranch`, `updateBranch`
    - HR: `createEmployee`, `updateEmployee`
    - Procurement: `createPurchaseRequest`, `updatePOStatus`
    - Accounting: `createJournalEntry`
    - Hire Purchase: `createHP`, `recordHPPayment`
    - Receivables: `recordARPayment`
    - Logistics: `createDelivery`, `updateDeliveryStatus`
    - Settings: `updateSettings`
    - AI: `aiChat`
  - Created automated test suite in `backend/tests/validation.test.js` validating HTML tag stripping, script tag stripping, recursive scrubbing, password preservation, and Joi middleware route schemas.
- Files affected:
  - `backend/utils/sanitizer.js`
  - `backend/middleware/validation.js`
  - `backend/tests/validation.test.js`
  - `backend/server.js`
  - `backend/routes/auth.js`
  - `backend/routes/inventory.js`
  - `backend/routes/sales.js`
  - `backend/routes/crm.js`
  - `backend/routes/suppliers.js`
  - `backend/routes/services.js`
  - `backend/routes/roles.js`
  - `backend/routes/branches.js`
  - `backend/routes/hr.js`
  - `backend/routes/procurement.js`
  - `backend/routes/accounting.js`
  - `backend/routes/hirePurchase.js`
  - `backend/routes/receivables.js`
  - `backend/routes/logistics.js`
  - `backend/routes/settings.js`
  - `backend/routes/ai.js`
  - `AGENT_CHANGELOG.md`
- Validation: All 11 unit tests in `backend/tests/validation.test.js` passed with 0 failures; verified server route modules load cleanly without errors.

### 2026-09-05 | Fix Customer Segment Validation Mismatch
- Scope: Input schema validation, CRM module
- Summary: Expanded CRM customer schema whitelist to accept `'regular'` alongside `'retail'`, `'b2b'`, `'wholesale'`, and `'vip'`, aligning with frontend modal segment options and database default values.
- Files affected:
  - backend/middleware/validation.js
  - AGENT_CHANGELOG.md
- Validation: Unit test verification confirmed `{ name: 'Jane Doe', segment: 'regular' }` validates successfully with 0 errors.


### 2026-09-05 | Centralized Security Audit Log (Who Did What)
- Scope: Backend security, database schema, mutation tracking, audit log API
- Summary:
  - Created `audit_logs` table tracking `user_id`, `user_name`, `user_role`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `details`, `ip`, `branch_id`, and `timestamp`.
  - Added centralized audit utility `backend/utils/auditLogger.js` and `/api/audit-logs` endpoint.
  - Wired audit triggers across critical mutations: item voids, price overrides, manual stock adjustments, user role escalations, password changes, custom role alterations, and journal entries.
- Files affected:
  - backend/db/database.js
  - backend/utils/auditLogger.js
  - backend/routes/auditLogs.js
  - backend/server.js
  - backend/controllers/salesController.js
  - backend/routes/sales.js
  - backend/controllers/inventoryController.js
  - backend/controllers/authController.js
  - backend/controllers/rolesController.js
  - backend/controllers/accountingController.js
  - AGENT_CHANGELOG.md
- Validation: Verified database table creation, controller audit event logging, and route permissions.

### 2026-09-05 | CRM Customer Branch Association and Scoping Fix
- Scope: CRM module, customer creation payload, branch querying
- Summary:
  - Updated `submitCustomerModal()` in `js/app.js` to attach active `branch_id` (`state.currentBranch?.id` or fallback `state.user?.branch_id`) to the creation payload.
  - Updated `getCustomers()` and `getCRMSummary()` in `backend/controllers/crmController.js` so branch-filtered queries also return unassigned / global customers (`c.branch_id = ? OR c.branch_id IS NULL`).
  - Added fallback in `createCustomer()` in `backend/controllers/crmController.js` to assign `req.user?.branch_id` if `branch_id` is omitted in the request body.
- Files affected:
  - `backend/controllers/crmController.js`
  - `js/app.js`
  - `AGENT_CHANGELOG.md`
- Validation: Verified code changes and logic.


### 2026-09-05 | Verification Audit & Schema Mismatch Fixes
- Scope: Backend validation middleware, schema correctness, feature integration check
- Summary: Performed a systematic end-to-end verification of all Sep 4-5 changes. Discovered and fixed 5 critical validation schema mismatches that were silently blocking core operations:
  1. **Login schema field mismatch** — `schemas.login` required `username` (alphanum) but `authController.login()` reads `email`. Fixed to accept `email` field with email format validation.
  2. **Register schema field mismatch** — `schemas.register` required `username` (alphanum) but controller reads `name` + `email`. Fixed to match controller field names and allowed roles list.
  3. **changePassword field name mismatch** — Schema expected `oldPassword`/`newPassword` but controller reads `current_password`/`new_password`. Fixed field names in schema.
  4. **Role creation schema type mismatch** — `schemas.createRole` expected `permissions` as an array of strings, but `rolesController` stores permissions as a JSON object (`{ sales: true, crm: true }`). Fixed to `Joi.object().pattern()` and added `base_role` field. Updated `updateRole` schema to match.
  5. **Employee update field stripping** — `schemas.updateEmployee` was missing `hourly_rate`, `commission_pct`, `statutory_paye_pct`, `statutory_nssf`, `statutory_nhif`, and `benefits_deduction` fields. Joi's `stripUnknown: true` was silently dropping all payroll data on every employee update save. Fixed both `createEmployee` and `updateEmployee` schemas to include all payroll and statutory fields.
- Files affected: `backend/middleware/validation.js`
- Verification: All 9 test assertions passed after fixes; employee payroll fields confirmed saved to database (hourly_rate and commission_pct both correctly persisted).
