# Dark/Light Mode Theme Toggle Graph Disappearance Fix

## Root Cause
1. **Destructive Destruction of All Chart Instances:** In `cycleTheme()` in `js/app.js`, toggling between Dark and Light mode ran:
   ```javascript
   Object.values(state.chartInstances).forEach(c => c.destroy && c.destroy());
   state.chartInstances = {};
   initCharts();
   ```
2. **Incomplete Chart Recreation:** `initCharts()` only initialized empty skeleton canvases for Dashboard (`revenueChart` and `paymentChart`) with all zero values (`[0, 0, 0, 0, 0, 0]`) without re-fetching or re-populating data.
3. **Total Chart Loss Across All Other Modules:** All chart instances in Accounting (`cashflowChart`, `expenseChart`), HR (`attendChart`, `payrollChart`), Procurement (`procureChart`), CRM (`crm`), and Branch Comparison (`compPageMainChart`, `compPageDonutChart`) were completely destroyed on theme toggle and left blank until a manual browser refresh (`F5`).

---

## Solutions Implemented

### 1. In-Place Theme Palette Updates ([`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js#L765-L815))
- Replaced destructive chart destruction with `updateAllChartsTheme()`:
  - Dynamically updates the text colors (`d.textColor`), grid lines (`d.gridColor`), and legends on all active chart instances in `state.chartInstances` in-place.
  - Calls `chart.update('none')` for smooth, zero-latency theme transitions without wiping data or resetting datasets.

### 2. Active View Chart Re-Sync
- In `cycleTheme()`, calls `triggerViewLoad(state.currentView)` to immediately re-sync the active page's charts and indicators with the current branch data and theme styling.

### 3. Self-Healing Lazy Chart Initialization
- Added safeguards in `loadDashboardKPIs()`, `loadAccounting()`, `loadHR()`, and `loadProcurement()` so that if any chart instance is missing or unmounted, it is automatically initialized and immediately populated with data.

---

## Verification
- Confirmed that toggling between Light and Dark mode preserves all charts across all modules (Dashboard, Accounting, HR, Procurement, CRM, and Branch Comparison).
- Verified that grid lines, labels, and ticks adjust their contrast colors instantly without requiring a page refresh.
