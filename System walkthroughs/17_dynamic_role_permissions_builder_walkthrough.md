# Dynamic Role & Permissions Builder Walkthrough

We have implemented a full **Dynamic Role & Permissions Management System** built directly into the **Enterprise HQ Overview** (Multi-Branch Performance Comparison).

---

## 1. Architecture Overview

```mermaid
graph TD
    Owner[Owner in HQ Overview] -->|Clicks Roles & Access Tab| HQ[HQ Roles Panel]
    HQ -->|Create/Edit Custom Role| Modal[Role Builder Modal]
    Modal -->|Define Module Permissions & Trust Level| API[/api/roles]
    API -->|Persists| DB[(custom_roles Table)]
    HR[Employee Modal in HR] -->|Populates System Roles Dropdown| HR_Select[Assign Custom Role to Staff]
    Staff[Assigned Staff Login] -->|applyRolePermissions| Sidebar[Filtered Sidebar Navigation]
    Staff -->|API Request| RBAC[rbac.js resolves base_role]
    RBAC -->|Enforces API Trust Guard| Server[Backend API Execution]
```

---

## 2. Changes Implemented

### Backend & Database
- **`backend/db/database.js`**: Added migration for `custom_roles` table with `name`, `description`, `base_role`, `permissions` (JSON), and `is_system` flag. Seeded standard system roles (Manager, Cashier, HR Officer, Accountant).
- **`backend/controllers/rolesController.js`**: Created controller with `getRoles`, `createRole`, `updateRole`, and `deleteRole`. System roles are protected against modification or deletion (returns HTTP 403). Deleting a custom role automatically resets any assigned users to `cashier` for safety.
- **`backend/routes/roles.js`**: Mounted at `/api/roles`, protected with `requireAuth` and `requireRole('owner')`.
- **`backend/middleware/rbac.js`**: Upgraded `requireRole` with dynamic `resolveBaseRole` that maps any custom role to its backend trust level (`manager`, `cashier`, `hr`, or `accountant`) before authorization.

### Frontend UI & Interactions
- **`index.html`**:
  - Added **"Roles & Access"** tab to the HQ area tab strip (`tab-comp-roles`).
  - Added **Role & Permission Management Panel** (`comp-roles-panel`) featuring a responsive role cards grid and a "+ Create New Role" button.
  - Added **Role Create/Edit Modal** (`role-modal`) with role name, backend trust level selector, description, and module access checkboxes for 14 system views (Sales, Services, CRM, HP, Inventory, Stock Movements, Procurement, Logistics, Accounting, Receivables, Suppliers, Z-Reports, HR, and AI).
- **`js/app.js`**:
  - Updated `switchComparisonArea('roles')` to toggle the roles panel while hiding the charts.
  - Implemented `loadRoles()` and `renderRolesGrid()` to display role cards with trust badges, active module pills, and Edit/Delete buttons.
  - Implemented `openRoleModal()`, `submitRoleModal()`, and `deleteRole()` with confirmation dialogs and toast feedback.
  - Enhanced `applyRolePermissions()` to resolve custom roles from `_rolesCache` and toggle sidebar items dynamically based on module permissions.
  - Enhanced `openEmployeeModal()` and `populateEmpRoleDropdown()` so all custom roles appear dynamically in the employee credential editor under an optgroup.

---

## 3. Verification & Testing

1. **API Endpoints Test**:
   - `GET /api/roles` returned 200 with 4 core seeded roles.
   - `POST /api/roles` created a custom role with custom permissions.
   - `PUT /api/roles/:id` updated the role name and permissions.
   - `DELETE /api/roles/:id` safely removed the role and reset affected users to cashier.
2. **Security Checks**:
   - Attempting to delete a system role (e.g. Manager / Cashier) was rejected with `403 System roles cannot be deleted.`
   - Attempting to edit a system role was rejected with `403 System roles cannot be modified.`
3. **App Startup**:
   - Backend restarted cleanly and is running on `http://localhost:5000`.
   - `js/app.js` passed all JavaScript syntax checks.
