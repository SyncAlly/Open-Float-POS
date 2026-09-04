# Time & Attendance, Sales-Driven Compensation, Deductions & Labor Analytics

## Overview of Implemented Capabilities
1. **Time & Attendance Tracking (POS Register Terminal):**
   - Implemented real-time **Clock-In / Clock-Out** widget in the Sales POS interface.
   - Automatically computes regular hours vs overtime thresholds ($>8\text{ hrs/day}$ at $1.5\times$).
   - Dynamically applies **Shift Differentials** (+10% evening, +30% night, +25% weekend).
   - Completely **removed the legacy manual attendance marking system** across all branches in favor of terminal clock events.

2. **Sales-Driven Compensation:**
   - Transactions are attributed to the individual cashier / staff member.
   - Computes configurable sales commission percentages (e.g. 2%–5%) automatically included in gross pay.

3. **Operational Deductions & Adjustments:**
   - Standard and statutory taxes automatically calculated (PAYE tax %, NSSF, NHIF / SHIF).
   - Cash drawer shift shortage deductions recorded during register reconciliation and applied directly to payroll.
   - Custom benefits deductions (health insurance, loans, advances).

4. **Labor Analytics & Payroll Export:**
   - Live **Labor-to-Sales Ratio (%)** calculation with health benchmarks ($<18\%$ healthy, $18-25\%$ monitor, $>25\%$ critical).
   - Interactive **Pay Stub Generator** with detailed itemized breakdown (Earnings vs Deductions) and Net Take-Home Pay.
   - Detailed accounting **CSV Export** for payroll integration.

---

## Technical Changes

### 1. Database Schema ([`backend/db/database.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/db/database.js))
- Added `time_entries` table: tracks `employee_id`, `branch_id`, `clock_in`, `clock_out`, `regular_hours`, `overtime_hours`, `hourly_rate`, `shift_type`, `differential_pct`, `status`.
- Added `payroll_records` table: stores shift payroll calculations, shortages, taxes, and net pay.
- Extended `employees` table: `hourly_rate`, `commission_pct`, `statutory_paye_pct`, `statutory_nssf`, `statutory_nhif`, `benefits_deduction`.

### 2. Backend Routes & Controller ([`backend/routes/hr.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/routes/hr.js), [`backend/controllers/hrController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/hrController.js))
- `POST /api/hr/clock-in`: starts shift and detects night/weekend shift differential.
- `POST /api/hr/clock-out`: ends shift, calculates regular vs overtime hours and applies drawer shortage deductions.
- `GET /api/hr/shift-status`: returns live register clock-in state for terminal header widget.
- `GET /api/hr/labor-analytics`: aggregates live labor costs against gross sales for scheduling ratio.
- `GET /api/hr/payroll/calculate`: returns itemized pay stub for any employee across custom date ranges.
- `GET /api/hr/payroll/export`: generates comprehensive payroll breakdown across all active staff.

### 3. Frontend Terminal & HR Views ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html), [`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js), [`css/style.css`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/css/style.css))
- **Sales Terminal Header:** `#terminal-clock-widget` with live pulse dot, active shift hours, and 1-click Clock In / Clock Out toggle.
- **HR Dashboard:** Replaced manual attendance with Clocked In Now live count, Labor vs Sales card, and Itemized Pay Stub Generator.
- **Employee Modal:** Added hourly rate, commission rate, PAYE %, NSSF, NHIF, and benefits fields.
