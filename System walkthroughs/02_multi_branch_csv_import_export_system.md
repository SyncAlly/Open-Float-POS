# Multi-Branch CSV Import & Export System

## Problem Investigated
When exporting and re-uploading a CSV in **Malindi Branch (Branch ID: 2)** with a new item (`Nike Airforce 1`) and updated stock for an existing item (`Gtr Toy Car`):
1. The batch upload controller was inserting records **without specifying `branch_id`**, which caused SQLite to assign them to `branch_id = 1` (Main Branch / HQ).
2. Existing product lookup was matching only by `sku = ?` instead of `sku = ? AND branch_id = ?`, causing cross-branch updates and missing records in the active branch.
3. The Upload modal store dropdown (`#upload-store-select`) was static and not dynamically populated or pre-selected with the active branch.
4. The Export CSV function was downloading global inventory instead of scoping to the currently selected branch.

---

## Changes Implemented

### 1. Branch-Scoped Batch Upload ([`uploadController.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/backend/controllers/uploadController.js))
- **Target Branch Resolution:** Resolves target branch from `item.branch_id`, `item.branch_name`, `req.body.branch_id`, `req.body.store_warehouse`, or `req.user.branch_id`.
- **Per-Branch Upsert (`SELECT id, image_url FROM products WHERE sku = ? AND branch_id = ?`):**
  - If the SKU exists in that target branch: updates stock, prices, categories, suppliers, and re-activates if previously deleted.
  - If the SKU does not exist in that branch: inserts a new row with `branch_id = targetBranchId`.
- **Image URL Preservation:** If re-uploading a CSV without changing images, existing local image paths are preserved.

### 2. Frontend Upload Modal & Dynamic Branch Pre-Selection ([`app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js))
- `openUploadModal()` queries `/api/branches` and dynamically populates the store select dropdown with all live branches, pre-selecting the active branch.
- `processUploadBatch()` attaches `branch_id: targetBranchId` to every payload and defaults CSV rows without an explicit branch column to the active branch.

### 3. Branch-Aware CSV Export ([`app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js))
- `exportInventoryCSV()` filters `/api/inventory?branch_id=${activeBranchId}`.
- Includes `branch_id` and `branch_name` in the CSV headers and data rows.
- Automatically names the file based on the branch name (e.g. `openfloat_malindi_branch_2026-08-28.csv`).

---

## Verification
- Tested uploading CSV to **Malindi Branch (`branch_id = 2`)** with `Gtr Toy Car` (`PRD-101`) and `Nike Airforce 1` (`AFC-101`).
- Verified that **Malindi Branch** displays both items and stock updates correctly.
- Verified that **Main Branch (`branch_id = 1`)** remains completely isolated with its own stock.
