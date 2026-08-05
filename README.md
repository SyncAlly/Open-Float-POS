# OpenFloat POS X - Documentation and User Guide

Welcome to OpenFloat POS X, an enterprise-grade Single Page Application (SPA) and backend system built for multi-branch retail, inventory control, services, hire purchase, receivables, Z-reports, human resources, financial accounting, logistics, and AI-assisted commerce.

---

## Architecture Overview

The system is engineered as a lightweight, zero-dependency, ultra-fast Single Page Application (SPA) using native HTML5, modern vanilla CSS3, clean ES6 JavaScript, and standard SVG graphics, backed by a Node.js Express API engine with SQLite.

- **`index.html`**: Main single DOM container housing all core views and modal dialogs.
- **`css/style.css`**: Design system tokens, Glassmorphic UI components, typography, layout grids, animations, and dark/light theme definitions.
- **`js/app.js`**: Core state management, authentication router, cart engine, payment gateway logic, Chart.js integrations, modal controllers, and notification handlers.
- **`backend/`**: Node.js Express server with modular API endpoints for all business domains.

---

## Core System Modules

### 1. Executive Dashboard (`#view-dashboard`)
The central command hub for business owners and general managers.
- **KPI Cards and Sparklines**: Real-time metrics for Today's Revenue, Gross Profit, Total Transactions, and Outstanding Debt with dynamic SVG sparkline trends.
- **Revenue and Profit Charts**: Interactive Chart.js visual trend comparison across different timeframes.
- **Payment Breakdown**: Donut chart displaying cash, M-Pesa, Card, and Credit transaction proportions.
- **Action Panels**: Live stock warnings, branch performance leaderboards, recent sales history, and approval queues.

### 2. POS Sales Terminal (`#view-sales`)
Cashier terminal optimized for rapid order creation and checkout.
- **Catalog Grid and Search**: Category filtering tabs and instant text/SKU search.
- **Cart Engine**: Real-time quantity adjustment, item deletion, custom discounts, customer selection, and loyalty point redemption.
- **Multi-Channel Payments**: Support for Cash with auto-change calculator, M-Pesa STK Push, Card/PDQ terminal references, and Split Payments.
- **Receipts and Order Holding**: Hold & recall order queues, thermal receipt preview generator, and instant printing.

### 3. Services Catalog (`#view-services`)
Management of non-inventory billable services.
- **Service Directory**: Service codes, names, categories (Automotive, Logistics, Electronics, Maintenance, Facilities), pricing, VAT flags, and store availability.
- **Batch Upload**: Upload service catalogs per store or warehouse via CSV/Excel.

### 4. Hire Purchase and Credit Sales (`#view-hire-purchase`)
Customer installment agreement management.
- **Agreement Portfolio**: Active, overdue, and completed hire purchase contracts.
- **Payment Progress**: Visual progress bars showing down payment, monthly installments, total paid count, remaining balance, and next due date.

### 5. Inventory Management (`#view-inventory`)
Stock control and warehouse tracking system.
- **Stock Status Counters**: Healthy stock, reorder warnings, out of stock items, and expiring products.
- **Filter and Search**: Filter products by category, stock status, or warehouse location.
- **Batch Upload**: Upload product catalogs per store or warehouse.

### 6. Stock Movement Log (`#view-stock-movements`)
Tracking inventory adjustments and audit logs.
- **Movement Categorization**: Log and track Sales, Customer Returns, Damaged Items, Expired Products, Stock Recount Adjustments, and Purchase Restocks.
- **Movement Logger**: Modal dialog for recording inventory quantity changes with reference numbers and operational notes.

### 7. Supplier Management (`#view-suppliers`)
Vendor relationship management.
- **Supplier Directory**: Vendor contacts, categories, performance ratings (e.g. 94/100), active status, and accounts payable metrics.

### 8. Procurement and Purchasing (`#view-procurement`)
Purchase request workflow and supplier ordering pipeline.
- **Purchase Requests**: Submit, approve, reject, or mark purchase orders delivered with automated inventory restocking.

### 9. Accounts Receivable and Debts (`#view-receivables`)
Tracking company receivables and customer credit balances.
- **Receivables Summary**: High-visibility banner displaying total outstanding company receivables, 30+ day overdue balances, and monthly collection rates.
- **Customer Ledger**: Amount owed per individual customer, credit limits, overdue days, risk level badges, and payment recording.

### 10. Z-Report Generator (`#view-z-reports`)
End-of-day terminal closure and session settlement.
- **3 Generation Modes**: Generate Z-reports By Cashier, By Manager, or By Store/Warehouse.
- **Settlement Preview**: Session metrics including Opening Float, Cash/M-Pesa/Card split, Discounts, Returns, VAT (16%), Net Revenue, and Closing Cash in Drawer.

### 11. Accounting and Financials (`#view-accounting`)
P&L, cash flow, and general ledger tracking.
- **Financial KPIs**: Total Revenue, Expenses, Net Profit, and COGS valuation.
- **Ledgers**: Accounts Receivable (AR) and Accounts Payable (AP) tracking.

### 12. Human Resources (`#view-hr`)
Staff directory, attendance tracking, and payroll processing.
- **Staff Directory**: Employee roles, assigned branches, status badges, and attendance percentages.
- **Attendance Tracker**: Mark daily attendance with auto-calculated attendance percentages.

### 13. Customer Relationship Management (`#view-crm`)
Customer retention and loyalty analytics.
- **Customer Profiles**: Total spend history, loyalty points, and credit limits.

### 14. Logistics and Fulfillment (`#view-logistics`)
Fleet tracking and delivery order management.
- **Active Deliveries**: Real-time status tracking for delivery vans, driver assignments, ETAs, and routes.

### 15. AI Business Assistant (`#view-ai`)
AI-driven business intelligence chat module.
- **Conversational Analytics**: Prompt-driven queries for stock restock advice, sales trends, and profit performance.

### 16. System and Store Settings (`#view-settings`)
Global system configuration.
- Business profile (Name, KRA PIN, HQ contact), M-Pesa Daraja API credentials, VAT tax rates, and hardware configurations (printers, barcode scanners, cash drawers).

---

## Authentication and Security

- **Universal Login Screen (`#login-screen`)**: Single authentication interface for all user roles (Owner/Administrator, Store Manager, Cashier, HR Officer, Accountant).
- **Session Tokens**: JWT bearer token authentication with 8-hour session expiry.
- **Role-Based Access Control (RBAC)**: Endpoint-level permissions enforced server-side. Cashiers are read-only; Managers can create and update; only Owners can delete records or change system settings.
- **Login Rate Limiting**: Maximum 10 login attempts per IP address per 15-minute window to block brute-force attacks.
- **CORS Policy**: API requests are restricted to known frontend origins only.

---

## Pre-Deployment Checklist

Complete every item below before going live on a production server.

### 🔴 Critical

- [ ] **Set `NODE_ENV=production` in `.env`** — This activates safe error handling that hides internal stack traces from API responses.
- [ ] **Add your live domain to `allowedOrigins`** in `backend/server.js`:
  ```js
  const allowedOrigins = [
    'https://your-production-domain.com', // ← Add this
    'http://localhost:5000',
  ];
  ```
- [ ] **Change all default passwords** — The seed user `owner@openfloat.com` uses `admin123`. Change it immediately via Settings → Change Password after first login.
- [ ] **Rotate the Gemini API key** if this project was ever pushed to a public git repository. Generate a new key at [aistudio.google.com](https://aistudio.google.com) and update `GEMINI_API_KEY` in `.env`.
- [ ] **Verify `.gitignore` is active** — `.env` and `backend/db/*.db` must never be committed. Run `git status` and confirm they do not appear as tracked files.

### 🟡 Recommended

- [ ] **Replace SQLite with PostgreSQL or MySQL** for multi-user concurrent access at scale. SQLite is suitable for single-server or low-traffic deployments only.
- [ ] **Enable HTTPS / TLS** — Run behind a reverse proxy (Nginx, Caddy) with a valid SSL certificate. Never serve the POS over plain HTTP in production.
- [ ] **Set up automated database backups** — Schedule daily copies of `backend/db/openfloat.db` to a separate storage location.
- [ ] **Configure a process manager** — Use `pm2` to keep the Node.js server alive and auto-restart on crash:
  ```bash
  npm install -g pm2
  pm2 start backend/server.js --name openfloat-pos
  pm2 save
  ```

---

## Global Features and Shortcuts

- **Command Palette (`Ctrl + K`)**: Quick search and navigation launcher overlay for all modules.
- **Branch Switcher**: Sidebar dropdown to switch between store locations (Nairobi Main, Westlands, Mombasa CBD, Kisumu).
- **Dark / Light Theme Toggle**: Accessible via topbar toggle button.
- **Notification Center**: Real-time notifications for stock alerts, payments, and system updates.
