# Payroll, Overtime & Shift Differentials Configuration

## Overview
Added a dedicated **Payroll, Overtime & Shift Rules** configuration panel to the **Settings** view, restricted exclusively to the Business Owner.

---

## Configurable Capabilities
1. **Daily Overtime Threshold:** Owner can configure the standard daily hours before overtime pay begins (default: 8 hours, customizable e.g. 7, 8.5, 9 hours).
2. **Overtime Pay Multiplier:** Owner can set the multiplier applied to overtime hours (default: 1.5x, customizable e.g. 1.25x, 1.75x, 2.0x).
3. **Evening Shift Differential (%):** Bonus percentage applied for shifts starting after 6:00 PM (default: 10%).
4. **Night Shift Differential (%):** Bonus percentage applied for shifts between 10:00 PM and 6:00 AM (default: 30%).
5. **Weekend Shift Differential (%):** Bonus percentage applied for Saturday and Sunday shifts (default: 25%).

---

## Technical Integration
1. **Settings View ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html)):** Added `Payroll, Overtime & Shift Rules` card with inputs for threshold, multiplier, evening %, night %, and weekend %.
2. **Settings Frontend ([`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js)):** Registered payroll setting fields in `SETTINGS_MAP` and `enterpriseFields` (auto-disabled for non-owners).
3. **HR & Payroll Engine ([`backend/controllers/hrController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/hrController.js)):** Added `getPayrollRules(db)` helper dynamically reading custom settings for `clockIn`, `clockOut`, `calculatePayroll`, `getLaborAnalytics`, and `exportPayroll`.
