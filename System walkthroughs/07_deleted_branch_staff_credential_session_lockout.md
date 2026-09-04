# Deleted Branch Staff Credential & Session Lockout

## Problem Identified
1. **Dangling Credentials on Inactive Branches:** When an employee was created in HR and assigned to a branch, a corresponding user login was created. When that branch was subsequently deleted (`is_active = 0`), the user login records remained active (`is_active = 1`).
2. **Missing Inactive Branch Check in Auth:** `login()` in `authController.js` only checked `WHERE u.is_active = 1` on the `users` table without verifying the parent branch's `is_active` status.
3. **Ghost Branch Operations:** Staff from deactivated branches were still able to log into the system and access a "deleted" branch context.

---

## Solutions Implemented

### 1. Automatic Account Inactivation on Branch Deletion ([`backend/controllers/branchController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/branchController.js#L77-L95))
- When a branch is deleted (`DELETE /api/branches/:id`):
  - Sets `branches.is_active = 0`.
  - Automatically disables all non-owner user accounts assigned to that branch:
    `UPDATE users SET is_active = 0 WHERE branch_id = ? AND role != 'owner'`
  - Marks all employees of that branch as terminated:
    `UPDATE employees SET status = 'terminated' WHERE branch_id = ?`

### 2. Active Branch Guard in Authentication ([`backend/controllers/authController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/authController.js#L25-L70))
- In `login()`:
  - Joins `branches` table to check `b.is_active`.
  - Blocks any non-owner staff whose assigned branch is inactive:
    ```javascript
    if (user.role !== 'owner') {
      if (user.branch_id && (user.branch_is_active === 0 || user.branch_is_active === null)) {
        return res.status(403).json({
          error: 'Your assigned branch location has been closed or deactivated. Please contact the business owner.'
        });
      }
    }
    ```
- In `me()`:
  - Validates that active JWT sessions belonging to non-owners cannot perform requests if their branch has been deactivated (`403 Assigned branch is deactivated`).

### 3. Individual Employee Deletion Safeguard ([`backend/controllers/hrController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/hrController.js#L84-L95))
- When an individual employee is removed from HR, their corresponding `users` account is automatically disabled (`is_active = 0`).

---

## Verification
Executed automated integration test (`test_deleted_branch_login.js`):
1. Created a branch and registered a cashier employee with login credentials.
2. Verified cashier could log in while branch was active (`200 OK`).
3. Deactivated the branch via owner credentials (`200 OK`).
4. Attempted cashier login on the deactivated branch -> **Blocked (`401 Invalid credentials or inactive account`)**.
5. Attempted API calls with cashier's previous token -> **Blocked (`401/403 Inactive account / branch`)**.
