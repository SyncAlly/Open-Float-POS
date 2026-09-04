# Inbuilt AI Assistant Multi-Branch Scoping & Role Permissions

## Requirement Summary
- **Branch Managers & Business Owner** have access to the Inbuilt AI Assistant.
- **Branch Manager:** The AI is strictly scoped to the specific branch the manager is assigned to (sales, stock levels, reorder alerts, staff attendance, customer accounts, and daily operations). The AI is prevented from disclosing confidential data from other branches.
- **Business Owner:** The AI has full enterprise-wide visibility across all branches with multi-branch comparative analytics, revenue rankings, cross-store stock balancing, and consolidated strategic insights.

---

## Solutions Implemented

### 1. Scoped Business Context Builder ([`backend/controllers/aiController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/aiController.js))
- In `buildBusinessContext(user, requestedBranchId)`:
  - **For Branch Manager:** Hard-locks `activeBranchId = user.branch_id`. Every single query (sales, products, inventory, customers, HR, purchase requests, deliveries) is filtered by `branch_id = ${activeBranchId}`. `enterprise_branches_breakdown` is omitted.
  - **For Business Owner:**
    - When viewing a specific branch, provides focused branch insights alongside enterprise context.
    - When in **Enterprise HQ / All Branches** mode, includes complete multi-branch breakdowns ranking all branches by 30-day revenue, order volume, catalog size, and staff headcount.

### 2. Role-Tailored System Prompts ([`backend/controllers/aiController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/aiController.js#L160-L200))
- **Manager Persona:** Instructed to act as a dedicated operational advisor for that specific branch. Strict instructions prohibit hallucinating or exposing other branches' numbers.
- **Owner Persona:** Instructed to act as an executive business analyst with complete enterprise-wide oversight and strategic profit maximization advice.

### 3. Role-Based Access Control (RBAC) & Dynamic Frontend UI ([`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js#L5908-L6060))
- Both `owner` and `manager` roles are granted access to the AI Assistant module (`/api/ai/chat` and `/api/ai/insights`).
- `loadAI()` dynamically updates header subtitles and prompt suggestion chips:
  - **Owner (HQ Mode):** Suggests enterprise comparison queries (*"Which branch is performing best?"*, *"Compare revenue across all branches"*).
  - **Branch Manager:** Suggests branch operational queries (*"Branch low stock alert"*, *"Branch sales summary"*, *"Staff attendance check"*).

---

## Verification
- Verified `buildBusinessContext` returns strictly isolated branch data for Branch Managers (`enterprise_branches_breakdown: null`).
- Verified `buildBusinessContext` provides enterprise comparisons across all active branches for Business Owner.
- Verified both Manager and Owner sessions authenticate and receive AI insights successfully.
