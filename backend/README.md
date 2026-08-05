# OpenFloat POS X - Backend Documentation

Welcome to the backend API service for OpenFloat POS X.

---

## Quick Start

1. Install Dependencies:
   ```bash
   npm install
   ```

2. Seed Initial Database:
   ```bash
   node backend/db/seed.js
   ```

3. Start Development Server:
   ```bash
   npm start
   ```
   The backend API will run at http://localhost:5000.

---

## Project Architecture

```
backend/
├── server.js              # Express app entry point & route mounting
├── README.md              # Backend documentation
├── db/
│   ├── database.js        # SQLite (sql.js) connection, schema & query helpers
│   └── seed.js            # Initial demo database seeder
├── middleware/
│   └── auth.js            # JWT Bearer token verification
├── routes/                # API Express Routers
│   ├── settings.js        # Module 1: Settings
│   ├── inventory.js       # Module 2: Inventory CRUD & Stock
│   ├── auth.js            # Module 3: Authentication & User Accounts
│   ├── hr.js              # Module 4: Staff & Attendance
│   ├── crm.js             # Module 5: Customer Loyalty & Credit
│   ├── sales.js           # Module 6: POS Checkout & Transactions
│   ├── procurement.js     # Module 7: Purchase Requests & Suppliers
│   ├── accounting.js      # Module 8: Financial Ledgers & Cashflow
│   └── logistics.js       # Module 9: Dispatch & Delivery Tracking
└── controllers/           # Business logic implementations
    ├── settingsController.js
    ├── inventoryController.js
    ├── authController.js
    ├── hrController.js
    ├── crmController.js
    ├── salesController.js
    ├── procurementController.js
    ├── accountingController.js
    └── logisticsController.js
```

---

## API Endpoint Reference (Ordered by Complexity)

### 1. Settings API (`/api/settings`)
- GET /api/settings: Retrieve flat object of all global settings.
- GET /api/settings/:key: Retrieve single setting value.
- PUT /api/settings: Bulk update configuration settings `{ key: value }`.

### 2. Inventory API (`/api/inventory`)
- GET /api/inventory/summary: Stock health summary (healthy, low, out, expiring).
- GET /api/inventory/categories: Product categories list.
- GET /api/inventory: Products list (supports filters: `?category=`, `?status=`, `?search=`).
- GET /api/inventory/:id: Product details.
- POST /api/inventory: Add new product.
- PUT /api/inventory/:id: Update product fields.
- PATCH /api/inventory/:id/stock: Adjust stock quantity `{"adjustment": +10}`.
- DELETE /api/inventory/:id: Soft delete product.

### 3. Authentication API (`/api/auth`)
- POST /api/auth/login: Authenticate user & return JWT token `{"email", "password"}`.
- GET /api/auth/me: Get active profile from JWT token.
- PUT /api/auth/change-password: Change user password.
- POST /api/auth/register: Create new staff user (Manager/Owner only).

### 4. Human Resources API (`/api/hr`)
- GET /api/hr/payroll/summary: Headcount, attendance %, total payroll costs.
- POST /api/hr/attendance: Record or update employee attendance (`present`, `absent`, `on_leave`).
- GET /api/hr/employees: Employee directory (supports `?branch_id=`, `?status=`, `?search=`).
- POST /api/hr/employees: Hire new employee.
- PUT /api/hr/employees/:id: Update employee records.
- DELETE /api/hr/employees/:id: Terminate employee record.

### 5. CRM & Loyalty API (`/api/crm`)
- GET /api/crm/summary: Customer totals, loyalty adoption, total credit balance.
- GET /api/crm/customers: Customer directory (supports `?segment=`, `?search=`).
- GET /api/crm/customers/:id: Customer profile + transaction history.
- POST /api/crm/customers: Create customer account.
- PUT /api/crm/customers/:id: Update customer details.
- POST /api/crm/customers/:id/redeem: Deduct loyalty points.

### 6. Sales Terminal API (`/api/sales`)
- POST /api/sales/checkout: Process POS order, calculate total/VAT/discount, record line items, award loyalty points, and decrement stock.
- GET /api/sales/transactions: Transaction history log.
- GET /api/sales/transactions/:id: Specific receipt & item details.

### 7. Procurement API (`/api/procurement`)
- GET /api/procurement/suppliers: Supplier directory & ratings.
- GET /api/procurement/requests: Purchase requests list.
- POST /api/procurement/requests: Submit purchase request.
- PATCH /api/procurement/requests/:id/status: Approve, reject, or mark delivered (delivered automatically restocks items).

### 8. Accounting API (`/api/accounting`)
- GET /api/accounting/overview: Revenue, expenses, net profit, AR balances.
- GET /api/accounting/ledgers: Accounts Receivable (AR) & Accounts Payable (AP) list.
- GET /api/accounting/entries: Journal entry ledger.
- POST /api/accounting/entries: Create custom manual expense/income journal entry.

### 9. Logistics API (`/api/logistics`)
- GET /api/logistics/deliveries: Active & historical deliveries.
- POST /api/logistics/deliveries: Dispatch new delivery order.
- PATCH /api/logistics/deliveries/:id/status: Update status (`in_transit`, `delayed`, `delivered`), assign driver/van/ETA.
