/** MODULE 7: Procurement Controller — Purchase orders, supplier tracking */

const { getDb, query, exec } = require('../db/database');

async function getPurchaseRequests(req, res) {
  try {
    const db = await getDb();
    const { status, supplier_id } = req.query;

    let sql = `
      SELECT pr.*, e.name AS requested_by_name, s.name AS supplier_name
      FROM purchase_requests pr
      LEFT JOIN employees e ON pr.requested_by = e.id
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (status)      { sql += ' AND pr.status = ?'; params.push(status); }
    if (supplier_id) { sql += ' AND pr.supplier_id = ?'; params.push(supplier_id); }

    sql += ' ORDER BY pr.created_at DESC';
    res.json({ success: true, count: query(db, sql, params).length, data: query(db, sql, params) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPurchaseRequest(req, res) {
  try {
    const db = await getDb();
    const { supplier_id, items, notes } = req.body;

    if (!supplier_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'supplier_id and at least one item required.' });
    }

    const ref = `PR-${Math.floor(1000 + Math.random() * 9000)}`;
    let totalValue = 0;

    for (const item of items) {
      totalValue += (item.unit_cost * item.qty);
    }

    const prResult = exec(db,
      `INSERT INTO purchase_requests (ref, requested_by, supplier_id, total_value, item_count, status, notes)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [ref, req.user ? req.user.id : null, supplier_id, totalValue, items.length, notes || null]
    );

    const prId = prResult.lastInsertRowid;

    for (const item of items) {
      exec(db,
        `INSERT INTO purchase_request_items (purchase_request_id, product_id, product_name, qty, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [prId, item.product_id || null, item.product_name, item.qty, item.unit_cost, (item.unit_cost * item.qty)]
      );
    }

    res.status(201).json({ success: true, id: prId, ref, total_value: totalValue, message: 'Purchase request submitted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePRStatus(req, res) {
  try {
    const db = await getDb();
    const { status } = req.body; // 'approved', 'rejected', 'delivered'
    if (!['approved', 'rejected', 'delivered', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const result = exec(db, 'UPDATE purchase_requests SET status = ? WHERE id = ?', [status, req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Purchase Request not found.' });

    // If marked delivered, automatically restock products
    if (status === 'delivered') {
      const items = query(db, 'SELECT product_id, qty FROM purchase_request_items WHERE purchase_request_id = ? AND product_id IS NOT NULL', [req.params.id]);
      for (const item of items) {
        exec(db, 'UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?', [item.qty, item.product_id]);
      }
    }

    res.json({ success: true, message: `Purchase request status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSuppliers(req, res) {
  try {
    const db = await getDb();
    const suppliers = query(db, 'SELECT * FROM suppliers WHERE is_active = 1 ORDER BY rating DESC');
    res.json({ success: true, data: suppliers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getPurchaseRequests, createPurchaseRequest, updatePRStatus, getSuppliers };
