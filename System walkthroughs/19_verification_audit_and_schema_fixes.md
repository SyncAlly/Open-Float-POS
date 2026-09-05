# Verification Audit & Validation Schema Mismatch Fixes

Performed a comprehensive end-to-end audit of all Sep 4-5 changes and discovered and fixed **5 critical silent bugs** in the validation middleware that were breaking core operations without visible errors.

---

## Fixes Applied

### 1. Login Schema — `email` field (was: `username`)
- **Bug:** `schemas.login` required `username` with `alphanum().min(3)` but `authController.login()` reads `req.body.email`. Every login attempt returned `400 Validation error: username is required` instead of authenticating.
- **Fix:** Changed to `email: customJoi.string().email().max(150).required()`

### 2. Register Schema — `email` field (was: `username`)
- **Bug:** Same mismatch — schema expected `username` but controller reads `name + email + password`.
- **Fix:** Schema now accepts `name`, `email`, `password`, `role`, `branch_id` matching controller exactly.

### 3. changePassword — Field names (was: `oldPassword`/`newPassword`)
- **Bug:** Schema defined `oldPassword`/`newPassword` but controller reads `current_password`/`new_password`.
- **Fix:** Schema field names corrected to `current_password` and `new_password`.

### 4. Role Creation — `permissions` type (was: array, needed: object)
- **Bug:** `schemas.createRole` declared `permissions: Joi.array().items(cleanString(100)).min(1).required()`. The roles controller stores permissions as a plain JS object (`{ sales: true, crm: true }`), not an array. Every `POST /api/roles` call returned `400 permissions must be an array`.
- **Fix:** Changed to `Joi.object().pattern(Joi.string(), Joi.boolean()).default({})`. Also added `base_role` field and allowed spaces in role names.

### 5. Employee Update — Missing payroll fields
- **Bug:** `schemas.updateEmployee` was missing `hourly_rate`, `commission_pct`, `statutory_paye_pct`, `statutory_nssf`, `statutory_nhif`, and `benefits_deduction`. Joi's `stripUnknown: true` silently dropped all payroll data from every save — the employee update returned 200 but all payroll settings reverted to defaults.
- **Fix:** All payroll and statutory fields added to both `createEmployee` and `updateEmployee` schemas.

---

## Verification Results (All PASS)

| Test | Status |
|---|---|
| Login with email field accepted | PASS |
| GET /api/roles returns 4 system roles | PASS |
| POST /api/roles with object permissions | PASS |
| Role name with spaces in it | PASS |
| System role DELETE blocked (403) | PASS |
| `view-roles` page exists in index.html | PASS |
| `nav-roles` sidebar item exists | PASS |
| GET /api/audit-logs returns 200 | PASS |
| XSS in email field sanitized | PASS |
| CRM customer with `regular` segment | PASS |
| Employee `hourly_rate` saved to DB | PASS |
| Employee `commission_pct` saved to DB | PASS |
