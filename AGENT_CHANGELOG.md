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
