/** Stock Movements Controller — Inventory log & audit tracking */
const { getDb, query, exec } = require('../db/database');

async function getMovements(req, res) {
  try {
    const db = await getDb();
    const { type, search } = req.query;
    let sql = 'SELECT * FROM stock_movements WHERE 1=1';
    const params = [];

    if (type && type !== 'all') { sql += ' AND movement_type = ?'; params.push(type.toUpperCase()); }
    if (search) { sql += ' AND (product_name LIKE ? OR sku LIKE ? OR ref LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    sql += ' ORDER BY created_at DESC LIMIT 100';
    const data = query(db, sql, params);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createMovement(req, res) {
  try {
    const db = await getDb();
    const { product_id, product_name, sku, movement_type, qty_change, reason, branch_name } = req.body;
    if (!product_name || !movement_type || qty_change == null) {
      return res.status(400).json({ error: 'product_name, movement_type, and qty_change are required.' });
    }

    const ref = 'MOV-' + Math.floor(1000 + Math.random() * 9000);
    const recorded_by = req.user ? req.user.name : 'System User';

    const result = exec(db,
      `INSERT INTO stock_movements (ref, product_id, product_name, sku, movement_type, qty_change, reason, recorded_by, branch_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, product_id || null, product_name, sku || '', movement_type.toUpperCase(), qty_change, reason || '', recorded_by, branch_name || 'Nairobi Main']
    );

    // Also update product stock quantity in products table if product_id is provided
    if (product_id) {
      exec(db, 'UPDATE products SET stock_qty = MAX(0, stock_qty + ?) WHERE id = ?', [qty_change, product_id]);
    }

    res.status(201).json({ success: true, id: result.lastInsertRowid, ref, message: 'Stock movement logged.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getMovements, createMovement };
