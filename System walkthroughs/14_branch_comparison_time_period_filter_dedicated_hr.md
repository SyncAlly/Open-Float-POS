# Branch Comparison Time Period Filter & Dedicated HR Management Page

## Summary of Changes
1. **Branch Comparison Time Period Filter:** Added an interactive timeframe filter (`Today`, `This Week`, `This Month`, `This Year`, `All Time`) to the Multi-Branch Performance Comparison page, dynamically updating the KPI cards, bar/line charts, revenue share donut, and the Benchmarking Matrix table rankings.
2. **Dedicated Standalone HR Management Page:** Made Human Resources its own standalone page accessible directly from the sidebar navigation in both Enterprise HQ mode and Branch-specific mode. Removed the embedded HR tab from Branch Comparison so benchmarking remains focused on comparative analytics.

---

## What Was Implemented

### 1. Time Period Filter on Branch Comparison ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html#L440-L460))
- Added `#comp-period-select` in the view header with options:
  - **Today**
  - **This Week**
  - **This Month**
  - **This Year**
  - **All Time** (default)
- **KPI Cards Synchronized:** Displays period revenue (e.g. *"Today's Enterprise Revenue"* or *"This Month's Enterprise Revenue"*) and updates the leading location for that timeframe.
- **Charts Synchronized:** Bar/Line comparison graphs and Donut contribution shares reflect the selected period's sales volume and order counts.
- **Matrix Table Synchronized:** Ranks branches based on sales generated during the active timeframe.

### 2. Standalone HR Page with Enterprise Multi-Branch Filtering ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html#L950-L970), [`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js#L5340-L5470))
- Updated sidebar permissions in `applyRolePermissions()` so the **Owner** can access `Human Resources` anytime, including in Enterprise HQ mode.
- Added `#hr-branch-filter` dropdown to the Employee Directory card header in `view-hr`:
  - In **Enterprise Mode**: Displays all staff across all branches with a dropdown filter (`All Branches`, `CBD Main`, `Westlands`, etc.) and enterprise-wide payroll & attendance KPIs.
  - In **Branch Mode**: Automatically scopes to that specific branch.
- Added live employee search (`searchEmployees`) and branch filter (`filterHRByBranch`).
- Removed the redundant `#tab-comp-staffhq` from the Branch Comparison page.

### 3. Backend Period Analytics ([`backend/controllers/branchController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/branchController.js#L110-L155))
- Enhanced `/api/branches/performance` SQL query to calculate:
  - `today_revenue` and `today_orders`
  - `week_revenue` and `week_orders`
  - `month_revenue` and `month_orders`
  - `year_revenue` and `year_orders`
  - `total_revenue` and `transaction_count` (all-time)
