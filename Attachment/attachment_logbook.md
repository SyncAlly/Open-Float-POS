# Multimedia University of Kenya (MMU)
## Faculty of Computing and Information Technology — Industrial Attachment Logbook
**Student Attachment Record: Weeks 1 to 7 (June 29, 2026 – August 14, 2026)**  
**Company**: OpenFloat  
**Project**: OpenFloat POS X Platform  

---

## WEEK 1: Orientation & Core Architecture Setup
**Dates**: June 29, 2026 – July 3, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 29/06/2026 | I reported for orientation at OpenFloat HQ, met my field supervisor, initialized the local development environment (Node.js, Express, SQLite), and configured the project Git version control repository (`SyncAlly/Open-Float-POS`). | 8 | Getting acquainted with the company culture and developer tools set a clear tone for the attachment. |
| **Tuesday** | 30/06/2026 | I designed the core relational database schema (`backend/db/database.js`) in SQLite, defining tables for users, branches, product categories, inventory items, and customer profiles with proper foreign key constraints. | 8 | Spending extra time normalizing the database schema early prevented data redundancy issues later. |
| **Wednesday** | 01/07/2026 | I implemented the Node.js Express API server engine (`backend/server.js`), created authentication middleware (`requireAuth`), and wrote the user authentication controller for login and credential validation (`POST /api/auth/login`). | 8 | Implementing JWT authentication gave me a deeper understanding of stateless session security. |
| **Thursday** | 02/07/2026 | I built the Single Page Application (SPA) foundation in `index.html` and `css/style.css`, establishing the modern design tokens, CSS variables, glassmorphic UI components, and universal single login interface. | 8 | Crafting a clean, modular CSS design system early saved significant time during component styling. |
| **Friday** | 03/07/2026 | I created the frontend state management engine and view router in `js/app.js` (`navTo()`, `checkSession()`), enabling persistent user sessions via `localStorage` and dynamic topbar user profile indicators. | 8 | Successfully linking the frontend state with local storage ensured seamless auto-login behavior. |

### Student’s Weekly Report (Week 1)

During my first week of industrial attachment at OpenFloat, I focused on establishing the core full-stack foundation for the OpenFloat POS X enterprise platform. I began by meeting my field supervisor, reviewing technical requirements, setting up Node.js and SQLite runtime environments, and configuring Git version control. I designed the relational database schema, ensuring data integrity across user accounts, store branches, inventory categories, and customer records.

Technically, I learned how to build a lightweight, dependency-free Single Page Application (SPA) using native HTML5, modern CSS3 design tokens, and modular ES6 JavaScript alongside an Express REST API backend. I implemented JSON Web Token (JWT) bearer authentication, securing API endpoints while maintaining smooth client-side session persistence.

A minor challenge I encountered was handling asynchronous database initialization in Node.js when using `sql.js` WASM bindings. Initially, API endpoints failed when hit immediately on server boot because the database file hadn't fully initialized into memory. I resolved this by wrapping the database handle in an asynchronous getter (`getDb()`) that promises initialization before processing incoming API requests.

---

## WEEK 2: Executive Dashboard & POS Sales Terminal
**Dates**: July 6, 2026 – July 10, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 06/07/2026 | I constructed the Executive Dashboard layout (`#view-dashboard`), creating responsive KPI summary cards for Today's Revenue, Gross Profit, Total Transactions, and Outstanding Debt with dynamic SVG trend indicators. | 8 | Designing high-visibility KPI cards made the executive landing view feel intuitive and data-rich. |
| **Tuesday** | 07/07/2026 | I integrated Chart.js into `js/app.js` (`initCharts()`), rendering real-time revenue vs. profit trend line graphs and payment method breakdown donut charts for business monitoring. | 8 | Destroying pre-existing chart instances before re-rendering prevented Canvas memory leaks. |
| **Wednesday** | 08/07/2026 | I developed the POS Sales Terminal catalog interface (`#view-sales`), implementing product category filter tabs, instant text/SKU search inputs, and visual stock status badges. | 8 | Optimizing DOM rendering for product cards significantly improved cashier search speeds. |
| **Thursday** | 09/07/2026 | I built the shopping cart engine in `js/app.js` (`addToCart()`, `updateQty()`), supporting quantity increments, item deletions, custom line-item discounts, and real-time subtotal calculations. | 8 | Handling state mutations immutably kept cart subtotal calculations accurate. |
| **Friday** | 10/07/2026 | I created multi-channel checkout processing (Cash with auto-change calculation, Card PDQ references, and Split Payments), held order queues (`openHeldOrders()`), and receipt generation logic. | 8 | Adding held order queues allowed cashiers to temporarily pause transactions during busy periods. |

### Student’s Weekly Report (Week 2)

In Week 2, I focused on building the two most critical operational interfaces of the platform: the Executive Dashboard and the POS Sales Terminal. On the dashboard, I implemented high-level key performance indicators and integrated Chart.js to visualize daily revenue, profit margins, and payment method distribution. On the sales terminal, I engineered a fast cashier interface complete with instant search, category filtering, cart management, line-item discount controls, and held-order queues.

I gained valuable experience working with interactive data visualization libraries and handling complex cart state mutations in pure JavaScript. I also learned how to implement multi-channel payment flows, supporting cash change calculations, M-Pesa STK prompts, card references, and split payments.

A mistake I made during chart initialization was failing to call `chart.destroy()` when switching dashboard time filters (e.g., from Today to This Month). This caused Canvas overlap glitches where old chart tooltips lingered over new data. I fixed this by tracking active Chart.js instances in global state and explicitly destroying old instances before instantiating new charts.

---

## WEEK 3: Inventory Control & Stock Health Analytics
**Dates**: July 13, 2026 – July 17, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 13/07/2026 | I created the Inventory Management view (`#view-inventory`), building stock health counters (Healthy Stock, Reorder Soon, Out of Stock, Dead Stock, Expiring) and filter toolbars. | 8 | Visualizing inventory metrics with color-coded cards gives managers instant stock visibility. |
| **Tuesday** | 14/07/2026 | I developed the backend inventory controller (`backend/controllers/inventoryController.js`), implementing endpoints for listing products, fetching stock health summaries, and querying categories. | 8 | Writing parameterised SQLite queries ensured database safety against SQL injection. |
| **Wednesday** | 15/07/2026 | I built the product creation and editing modal (`#product-modal`), allowing store managers to register items with SKU, category, buying price, selling price, reorder level, unit, and expiry date. | 8 | Reusing a single modal for both creation and editing kept the HTML template clean. |
| **Thursday** | 16/07/2026 | I implemented automated profit margin calculations and stock health badges (`badge-green`, `badge-amber`, `badge-red`) to flag items dropping below reorder thresholds. | 8 | Calculating profit margins dynamically helped store owners identify high-margin inventory. |
| **Friday** | 17/07/2026 | I built product search and multi-criteria filtering logic (`filterInventory()`), allowing managers to query items by category, keyword, status, or warehouse location. | 8 | Filtering cached data on the client side provided instant search responses without server latency. |

### Student’s Weekly Report (Week 3)

Week 3 was dedicated to developing the Inventory Management module. I designed an intuitive warehouse tracking dashboard featuring real-time stock status counters, reorder warnings, profit margin analytics, and out-of-stock indicators. I also built the product CRUD modal and backend endpoints, enabling store managers to add, update, and manage inventory items across multiple store branches.

Through this work, I strengthened my understanding of backend API design, data normalization, and client-side data caching strategies. I learned how to structure parameterised SQL queries in Node.js to safely update product quantities and maintain transactional integrity.

One challenge I faced was handling floating-point arithmetic errors when computing profit margins (e.g., `0.1 + 0.2 = 0.30000000000000004`). This resulted in messy decimal places on the UI. I resolved this issue by implementing a centralized formatting helper function (`fmt()`) using `Math.round()` to cleanly format currency and percentage values to two decimal places.

---

## WEEK 4: Stock Movement Audits & Services Catalog (Field Supervisor Feedback Phase 1)
**Dates**: July 20, 2026 – July 24, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 20/07/2026 | Following my field supervisor's feedback, I designed the Stock Movement Log module (`#view-stock-movements`) to record inventory audit changes (sales, returns, damages, expiries, adjustments). | 8 | Addressing supervisor feedback early ensured the platform met real-world warehouse audit needs. |
| **Tuesday** | 21/07/2026 | I built the backend stock movements controller (`backend/controllers/stockMovementsController.js`) and database tables to record inventory quantity changes with reference IDs and operational reasons. | 8 | Storing complete audit histories ensures accountability for inventory shrinkage or damage. |
| **Wednesday** | 22/07/2026 | I created the stock movement entry modal (`#stock-movement-modal`), allowing warehouse staff to log manual stock recount adjustments and view real-time audit logs. | 8 | Enabling manual recount adjustments gave store managers a tool for monthly stock taking. |
| **Thursday** | 23/07/2026 | I developed the billable Services Catalog module (`#view-services`), allowing non-inventory services (repair, delivery, installation, maintenance) to be managed and billed at checkout. | 8 | Adding service support expanded the application's usability to service-based retail stores. |
| **Friday** | 24/07/2026 | I created the backend services controller (`backend/controllers/servicesController.js`) and service management modal (`#service-modal`) to configure service codes, hourly rates, and VAT flags. | 8 | Differentiating billable services from physical inventory prevented accidental stock decrements. |

### Student’s Weekly Report (Week 4)

During Week 4, I implemented the first phase of feedback provided by my field supervisor. The supervisor highlighted the need to track non-sale inventory changes and support non-physical service billing. In response, I designed and implemented the Stock Movement Audit Log and the billable Services Catalog.

I learned how to manage audit logging in relational databases, ensuring that every stock deduction or addition is backed by an immutable movement record (tagged as SALE, RETURN, DAMAGE, EXPIRY, ADJUSTMENT, or PURCHASE). I also gained experience handling non-inventoried items, allowing businesses to bill for hourly labor, installation, or logistics trips alongside physical products.

A initial mistake occurred when processing service items at checkout: the POS checkout engine attempted to decrement product stock levels for service items, causing foreign key constraint failures. I corrected this by adding an item type flag (`is_service`) in the cart payload to bypass stock decrement queries for billable services.

---

## WEEK 5: Hire Purchase, Suppliers & Receivables (Field Supervisor Feedback Phase 2)
**Dates**: July 27, 2026 – July 31, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 27/07/2026 | I created a separate sidebar module for Hire Purchase & Credit Sales (`#view-hire-purchase`), tracking customer installment agreements, down payments, monthly collections, and overdue accounts. | 8 | Building visual payment progress bars helped make credit contract monitoring straightforward. |
| **Tuesday** | 28/07/2026 | I developed the dedicated Supplier Management module (`#view-suppliers`) to manage vendor contacts, categories, performance ratings (e.g., 94/100), active statuses, and payables. | 8 | Tracking supplier performance ratings enables business owners to evaluate vendor reliability. |
| **Wednesday** | 29/07/2026 | I created the Accounts Receivable & Customer Debts module (`#view-receivables`), featuring a high-visibility summary banner displaying total company receivables and overdue debt balances. | 8 | Highlighting 30+ day overdue debt metrics gives credit control teams immediate visibility. |
| **Thursday** | 30/07/2026 | I built customer debt tracking ledgers, displaying individual credit limits, overdue days, risk level badges (`badge-red` HIGH, `badge-amber` MEDIUM), and payment recording modal helpers. | 8 | Risk level badges help staff quickly identify high-risk credit customers before extending credit. |
| **Friday** | 31/07/2026 | I integrated backend controllers (`receivablesController.js`, `suppliersController.js`, `hirePurchaseController.js`) and verified CSV export functions for all three modules. | 8 | Implementing CSV exports across all modules provided store managers with easy report downloads. |

### Student’s Weekly Report (Week 5)

Week 5 focused on implementing Phase 2 of the supervisor feedback by creating three dedicated business modules: Hire Purchase & Credit Sales, Supplier Management, and Accounts Receivable (AR). These additions transformed the POS from a basic checkout system into an end-to-end retail ERP platform capable of managing credit agreements and vendor payables.

I gained valuable experience modeling credit management logic, calculating installment balances, tracking customer debt aging, and building risk assessment indicators. I also learned how to structure clean HTML data tables with actionable row buttons for recording partial debt payments.

A challenge I encountered was maintaining sync between customer credit balances and sales transactions. When a credit sale was completed, the customer's total balance owed wasn't updating automatically in the receivables ledger. I fixed this by adding database transaction hooks in `salesController.js` that automatically update customer balance fields whenever a credit purchase or payment is recorded.

---

## WEEK 6: Z-Reports, Bulk Upload & Security Hardening (Field Supervisor Feedback Phase 3)
**Dates**: August 3, 2026 – August 7, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 03/08/2026 | I developed the Z-Report Generator module (`#view-z-reports`), enabling terminal closure reports to be generated by Cashier, Manager, or Store/Warehouse location with printable summaries. | 8 | Z-Reports provide store owners with essential end-of-day reconciliation data. |
| **Tuesday** | 04/08/2026 | I built the Bulk Store/Warehouse CSV Upload engine (`#upload-modal` & `uploadController.js`) to allow bulk imports of products and services per store location. | 8 | Bulk CSV importing significantly reduces setup time for stores with large product catalogs. |
| **Wednesday** | 05/08/2026 | I performed a comprehensive security audit of the application, created a `.gitignore` file to protect `.env` secrets, and generated cryptographically strong 64-byte JWT secrets. | 8 | Auditing code for security vulnerabilities before deployment prevented accidental credential leaks. |
| **Thursday** | 06/08/2026 | I implemented server-side Role-Based Access Control (`middleware/rbac.js`) and login rate-limiting (`express-rate-limit`, 10 attempts/15 min) to block brute-force attacks on auth endpoints. | 8 | Restricting administrative endpoints by role ensures cashiers cannot alter system settings. |
| **Friday** | 07/08/2026 | I locked down CORS policies in `server.js`, added a global error handler to prevent internal stack trace leaks in production, and updated the pre-deployment security checklist in `README.md`. | 8 | Setting up environment-aware error handling prepared the application for production deployment. |

### Student’s Weekly Report (Week 6)

In Week 6, I completed the final items from the field supervisor's feedback checklist and conducted a thorough security audit of the full application. I built the Z-Report end-of-day closure generator, implemented bulk CSV importing for inventory and services, and hardened the API against common OWASP top 10 security risks.

I learned critical cybersecurity practices for Node.js backends, including rate-limiting login attempts to prevent brute-force attacks, creating Role-Based Access Control (RBAC) middleware (`requireRole`), locking down CORS to allowed origins, and masking internal error stack traces in production (`NODE_ENV=production`).

A major security vulnerability I discovered during the audit was that the Google Gemini AI endpoints (`/api/ai/chat` and `/api/ai/insights`) had no authentication middleware attached, leaving API quotas exposed to public unauthenticated requests. I immediately fixed this by securing all AI routes with the `requireAuth` JWT middleware.

---

## WEEK 7: Advanced Modules, Role Restrictions & UX Polish
**Dates**: August 10, 2026 – August 14, 2026

### Daily Log

| Day | Date | Work Done | Hours Worked | Remarks by Intern |
|---|---|---|---|---|
| **Monday** | 10/08/2026 | I integrated the Human Resources & Payroll module (`#view-hr`), building staff directories, attendance percentage metrics, and payroll summary views. | 8 | Integrating HR and payroll management streamlined staff administration within the platform. |
| **Tuesday** | 11/08/2026 | I implemented the Logistics & Delivery module (`#view-logistics`) with Leaflet.js live delivery maps, driver assignment tracking, and route delivery statuses. | 8 | Integrating Leaflet maps added real-time visual tracking for store delivery fleets. |
| **Wednesday** | 12/08/2026 | I integrated the AI Business Assistant module (`#view-ai`), connecting the Google Gemini API for natural language queries regarding stock restocks and profit performance. | 8 | Connecting conversational AI provided store owners with instant business insights. |
| **Thursday** | 13/08/2026 | I updated role-based view permissions in `js/app.js` (`applyRolePermissions()`), restricting Cashiers from accessing Executive Dashboards and redirecting Cashier logins to the POS Sales Terminal. | 8 | Tailoring landing views by role ensured cashiers are directed straight to their working terminal. |
| **Friday** | 14/08/2026 | I optimized POS category filtering using `.includes()` substring matching and overhauled the Sales History view into an in-app modal with itemized receipt breakdowns and CSV export. | 8 | Replacing pop-up print windows with inline receipt modals created a smoother user experience. |

### Student’s Weekly Report (Week 7)

During Week 7, I integrated the final advanced modules—Human Resources & Payroll, Logistics delivery tracking, and the Gemini AI Business Assistant—and polished the user interface for production readiness. I also refined role-based navigation controls so that cashiers land directly on the POS Sales Terminal instead of viewing executive sales metrics.

I deepened my technical knowledge of third-party API integrations, mapping libraries (Leaflet.js), and role-based frontend routing. I also improved client-side data handling by fixing category filter matching and replacing disruptive pop-up windows with clean in-app receipt modals.

A bug I fixed on Friday was in the POS category filtering system: category buttons passed short keys (e.g., `"food"`), whereas database products stored full names (e.g., `"food & beverage"`). Strict equality checking (`===`) resulted in zero matching products. I resolved this by updating the filter to use `.includes()` substring matching, restoring correct product filtering across all category tabs.
