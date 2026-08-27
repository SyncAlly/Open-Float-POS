/** Stock Movements Controller — Inventory log & audit tracking */
const { getDb, query, exec } = require('../db/database');

async function getMovements(req, res) {
  try {
    const db = await getDb();
    const { type, search, branch_id } = req.query;
    let sql = 'SELECT * FROM stock_movements WHERE 1=1';
    const params = [];

    if (type && type !== 'all') { sql += ' AND movement_type = ?'; params.push(type.toUpperCase()); }
    if (search) { sql += ' AND (product_name LIKE ? OR sku LIKE ? OR ref LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    // Filter by branch if provided (and not 'all' / HQ mode)
    if (branch_id && branch_id !== 'all') {
      sql += ' AND branch_id = ?';
      params.push(branch_id);
    } else if (!branch_id && req.user && req.user.role !== 'owner' && req.user.branch_id) {
      sql += ' AND branch_id = ?';
      params.push(req.user.branch_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT 200';
    const data = query(db, sql, params);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createMovement(req, res) {
  try {
    const db = await getDb();
    const {
      product_id, product_name, sku, movement_type, qty_change, reason, branch_name,
      from_branch_id, to_branch_id
    } = req.body;

    if (!product_name || !movement_type || qty_change == null) {
      return res.status(400).json({ error: 'product_name, movement_type, and qty_change are required.' });
    }

    const ref = 'MOV-' + Math.floor(1000 + Math.random() * 9000);
    const recorded_by = req.user ? req.user.name : 'System User';
    const upperType = movement_type.toUpperCase();

    // ── INTER-BRANCH TRANSFER ────────────────────────────────────────────────
    if (upperType === 'TRANSFER') {
      if (!from_branch_id || !to_branch_id || String(from_branch_id) === String(to_branch_id)) {
        return res.status(400).json({ error: 'TRANSFER requires distinct from_branch_id and to_branch_id.' });
      }
      if (!product_id) {
        return res.status(400).json({ error: 'product_id is required for inter-branch transfers.' });
      }

      const transferQty = Math.abs(parseInt(qty_change));

      // 1. Verify source product exists at from_branch and has sufficient stock
      const srcRows = query(db,
        'SELECT * FROM products WHERE id = ? AND branch_id = ? AND is_active = 1',
        [product_id, from_branch_id]
      );
      if (!srcRows.length) {
        return res.status(404).json({ error: 'Source product not found at origin branch.' });
      }
      const srcProduct = srcRows[0];
      if (srcProduct.stock_qty < transferQty) {
        return res.status(400).json({
          error: `Insufficient stock. Available at source: ${srcProduct.stock_qty} ${srcProduct.unit || 'pcs'}.`
        });
      }

      // 2. Get branch names for logging
      const fromBranchRows = query(db, 'SELECT name FROM branches WHERE id = ?', [from_branch_id]);
      const toBranchRows   = query(db, 'SELECT name FROM branches WHERE id = ?', [to_branch_id]);
      const fromBranchName = fromBranchRows.length ? fromBranchRows[0].name : `Branch #${from_branch_id}`;
      const toBranchName   = toBranchRows.length   ? toBranchRows[0].name   : `Branch #${to_branch_id}`;

      // 3. Deduct from source branch product
      exec(db, "UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime('now') WHERE id = ?",
        [transferQty, srcProduct.id]);

      // 4. Find or create product at destination branch
      const destRows = query(db,
        'SELECT id, stock_qty FROM products WHERE sku = ? AND branch_id = ? AND is_active = 1',
        [srcProduct.sku, to_branch_id]
      );
      let destProductId;
      if (destRows.length) {
        destProductId = destRows[0].id;
        exec(db, "UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?",
          [transferQty, destProductId]);
      } else {
        // Clone product record at destination branch
        const cloneResult = exec(db,
          `INSERT INTO products (name, sku, category_id, buy_price, sell_price, stock_qty,
             reorder_level, unit, supplier_id, expiry_date, branch_id, image_url, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [srcProduct.name, srcProduct.sku, srcProduct.category_id,
           srcProduct.buy_price, srcProduct.sell_price, transferQty,
           srcProduct.reorder_level, srcProduct.unit, srcProduct.supplier_id,
           srcProduct.expiry_date, to_branch_id, srcProduct.image_url]
        );
        destProductId = cloneResult.lastInsertRowid;
      }

      // 5. Log TRANSFER_OUT at source
      const outRef = ref + '-OUT';
      exec(db,
        `INSERT INTO stock_movements (ref, product_id, product_name, sku, movement_type,
           qty_change, reason, recorded_by, branch_name, branch_id, from_branch_id, to_branch_id)
         VALUES (?, ?, ?, ?, 'TRANSFER_OUT', ?, ?, ?, ?, ?, ?, ?)`,
        [outRef, srcProduct.id, srcProduct.name, srcProduct.sku,
         -transferQty, reason || `Transfer to ${toBranchName}`,
         recorded_by, fromBranchName, from_branch_id, from_branch_id, to_branch_id]
      );

      // 6. Log TRANSFER_IN at destination
      const inRef = ref + '-IN';
      exec(db,
        `INSERT INTO stock_movements (ref, product_id, product_name, sku, movement_type,
           qty_change, reason, recorded_by, branch_name, branch_id, from_branch_id, to_branch_id)
         VALUES (?, ?, ?, ?, 'TRANSFER_IN', ?, ?, ?, ?, ?, ?, ?)`,
        [inRef, destProductId, srcProduct.name, srcProduct.sku,
         transferQty, reason || `Transfer from ${fromBranchName}`,
         recorded_by, toBranchName, to_branch_id, from_branch_id, to_branch_id]
      );

      return res.status(201).json({
        success: true,
        ref: outRef,
        dest_product_id: destProductId,
        message: `Transferred ${transferQty} units of "${srcProduct.name}" from ${fromBranchName} to ${toBranchName}.`
      });
    }

    // ── STANDARD SINGLE-BRANCH MOVEMENT ────────────────────────────────────
    const branchId = req.body.branch_id || (req.user ? req.user.branch_id : 1) || 1;

    const result = exec(db,
      `INSERT INTO stock_movements (ref, product_id, product_name, sku, movement_type,
         qty_change, reason, recorded_by, branch_name, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, product_id || null, product_name, sku || '', upperType,
       qty_change, reason || '', recorded_by,
       branch_name || 'Main Branch', branchId]
    );

    if (product_id) {
      exec(db, 'UPDATE products SET stock_qty = MAX(0, stock_qty + ?) WHERE id = ?', [qty_change, product_id]);
    }

    res.status(201).json({ success: true, id: result.lastInsertRowid, ref, message: 'Stock movement logged.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteMovement(req, res) {
  try {
    const db = await getDb();
    const result = exec(db, 'DELETE FROM stock_movements WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Movement not found.' });
    res.json({ success: true, message: 'Stock movement entry deleted from database.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getMovements, createMovement, deleteMovement };

