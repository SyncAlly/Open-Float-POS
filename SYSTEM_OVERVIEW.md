OpenFloat POS X - System Overview

Version: 1.0
Stack: Node.js + Express, SQLite, Vanilla JS/HTML/CSS


What This System Does

OpenFloat POS X is a full point-of-sale and business management platform designed for multi-branch retail and service businesses in Kenya. It covers sales, inventory, HR, accounting, logistics, hire purchase, and reporting, all from a single web interface.


Modules at a Glance

Sales Terminal (POS) - Cashier interface for ringing up products and billable services
Inventory - Stock management, SKUs, reorder levels, categories
Services Catalog - Billable services (e.g. Vehicle Inspection, Installation)
HR - Employee records, payroll, attendance, login credential management
Accounting - Revenue tracking, expense recording, profit/loss
Hire Purchase - Installment agreement management and credit sales
Receivables - Customer debt tracking and collection
Suppliers - Vendor management and purchase orders
Logistics - Delivery and dispatch management
Z-Reports - End-of-day closure reports by cashier, manager, or store
Stock Movements - Audit log of all inventory changes (sales, returns, damages, adjustments)
CRM - Customer profiles, loyalty points, credit limits
Dashboard - Executive KPI overview with branch performance and live charts


M-Pesa Integration

M-Pesa STK Push is integrated directly into the POS checkout flow. When a cashier selects M-Pesa as the payment method:

1. The cashier enters the customer's phone number (no number is preloaded, entered fresh each transaction).
2. An STK Push prompt is sent to the customer's phone via the Daraja API.
3. The system polls for payment confirmation and updates the transaction status automatically.
4. A manual confirmation fallback is available if the STK Push is not received. The cashier can enter the M-Pesa reference code manually.

Status: Integrated and tested as working.


Employee Management (HR)

All staff are created and managed through the HR module. The Owner account is the only account that exists at initial setup. All other users are added through HR.

Add Employee: Fill in name, role, department, salary, contact, and branch assignment.
Login Credentials: Each employee's system username, password, and role can be set or updated directly inside the HR Edit modal. No separate admin panel needed.
Branch Assignment: Assigning an employee to a branch in HR automatically syncs their login session to that branch. When they log in, they are locked to their assigned branch.
Role-Based Access: Each role (Cashier, Manager, HR, Accountant, Owner) sees only the pages relevant to their function. For example, Cashiers cannot access the Inventory or Services Catalog pages directly.
Payroll: The HR dashboard shows a payroll breakdown chart (Basic, Allowances, Deductions) pulled live from the database.


Branch Management

Branches are created by the Owner and represent physical store or warehouse locations.

Multi-Branch Support: The system supports multiple active and inactive branches simultaneously.
Employee-Branch Link: Each employee is assigned to one branch. On login, non-owner roles are locked to their branch session automatically. The branch shown in their interface matches their assignment in HR.
Dashboard Visibility: The executive dashboard lists all branches (active and inactive), showing revenue per branch and flagging inactive or zero-sales branches clearly instead of hiding them.
Branch Sync: If an employee's branch is changed in HR, the change takes effect on their next login. No manual user table update required.


Services Billing

Services (e.g. Vehicle Inspection, Delivery Fee, Equipment Repair) are managed in the Services Catalog and are billable directly through the POS Sales Terminal.

In the POS, a Services category tab appears alongside product categories (Food & Bev, Electronics, etc.).
Cashiers click a service to add it to the cart. It shows as a Billable Service with its unit (e.g. Per Session, Per Trip) instead of a stock count.
Services do not deplete physical inventory.
Products and services can be mixed freely in the same cart and billed together in one transaction.
Access to the Services Catalog page itself is restricted to Managers and Owners. Cashiers bill services only through the POS terminal.


Role Access Summary

Owner - Full access to all modules
Manager - Full access to all modules
Cashier - Sales, CRM, Hire Purchase, Z-Reports, Logistics, Stock Movements
HR - HR module only
Accountant - Accounting, Receivables, Suppliers, Z-Reports, Procurement


Last updated: August 2026
