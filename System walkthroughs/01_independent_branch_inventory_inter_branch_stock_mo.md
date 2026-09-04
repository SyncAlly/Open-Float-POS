# Independent Branch Inventory & Inter-Branch Stock Movement System

## Summary of Changes

Each branch now operates as a completely independent business location with its own warehouse stock. Automatic sharing of inventory between branches is eliminated, and moving stock between branches is achieved exclusively via explicit **Inter-Branch Warehouse Transfers**.

---

### 1. Database Schema & Multi-Branch Scoping ([`database.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/db/database.js))
- **Per-Branch SKU Support:** Migrated the SQLite `products` table so that identical SKUs (e.g. `PRD-101`) can exist in multiple branches independently with separate stock quantities, buy/sell prices, and reorder levels.
- **Stock Movements Audit Columns:** Added `branch_id`, `from_branch_id`, and `to_branch_id` to `stock_movements` to trace intra-branch and inter-branch movements.

---

### 2. Backend Inventory API ([`inventoryController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/inventoryController.js))
- **Strict Branch Query Filtering (`GET /api/inventory?branch_id=X`):**
  - When in a specific branch view, only items belonging to that `branch_id` are returned.
  - When in Owner HQ overview mode (`branch_id=all`), all products across all locations are returned along with `branch_name`.
- **Branch-Aware Product Creation (`POST /api/inventory`):**
  - Newly created products are assigned to the currently selected branch.
  - Per-branch SKU duplicate prevention: A product SKU is validated against the target branch rather than blocking other branches from stocking the same SKU.

---

### 3. Inter-Branch Warehouse Transfer System ([`stockMovementsController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/stockMovementsController.js))
- **`TRANSFER` Movement Processing:**
  - Validates source branch stock availability before transferring.
  - Deducts `qty` from the source branch product.
  - If the SKU already exists at the destination branch, increments its stock; if it does not yet exist, automatically clones the product catalog entry for the destination branch with initial stock.
  - Automatically logs twin audit records: `TRANSFER_OUT` at the origin warehouse and `TRANSFER_IN` at the receiving warehouse.

---

### 4. Frontend Terminal & Inventory Management ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html) & [`app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js))
- **POS Sales Terminal:** Loads and sells stock strictly belonging to the active branch session (`state.currentBranch.id`).
- **Inventory View:** Displays stock levels specific to the active branch.
- **Add/Edit Product Modal:** Includes a **Branch / Warehouse** selector pre-filled with the active branch.
- **Stock Movement & Transfer Modal:**
  - Added **Transfer to Another Branch Warehouse** movement option.
  - Dynamically shows **From Branch (Source)** and **To Branch (Destination)** dropdowns with autocomplete search filtered to products available at the source warehouse.
  - Table badges display styled `TRANSFER OUT` (amber) and `TRANSFER IN` (purple) pills with complete movement audit details.

---

## Verification Results

- Verified schema migration and per-branch SKU coexistence.
- Verified inter-branch transfer of 2 units of `Gtr Toy Car` (`PRD-101`) from Branch 1 to Branch 2:
  - Branch 1 stock decremented from 47 to 45 units.
  - Branch 2 received 2 units.
  - Twin audit records `MOV-XXXX-OUT` and `MOV-XXXX-IN` generated and persisted.
- Syntax checks passed across all JavaScript files.
