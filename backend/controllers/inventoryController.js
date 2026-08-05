/** MODULE 2: Inventory Controller — Products full CRUD */

const { getDb, query, exec } = require('../db/database');

async function getProducts(req, res) {
  try {
    const db = await getDb();
    const { category, status, search } = req.query;

    let sql = `
      SELECT p.*, c.name AS category_name, s.name AS supplier_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN suppliers  s ON p.supplier_id = s.id
      WHERE p.is_active = 1
    `;
    const params = [];

    if (category) { sql += ' AND c.slug = ?'; params.push(category); }
    if (search)   { sql += ' AND (p.name LIKE ? OR p.sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (status === 'low')      sql += ' AND p.stock_qty > 0 AND p.stock_qty <= p.reorder_level';
    if (status === 'out')      sql += ' AND p.stock_qty = 0';
    if (status === 'expiring') sql += " AND p.expiry_date IS NOT NULL AND p.expiry_date <= date('now', '+7 days')";

    sql += ' ORDER BY p.name';
    const products = query(db, sql, params);
    res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getProduct(req, res) {
  try {
    const db = await getDb();
    const rows = query(db,
      `SELECT p.*, c.name AS category_name, s.name AS supplier_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN suppliers  s ON p.supplier_id = s.id
       WHERE p.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createProduct(req, res) {
  try {
    const db = await getDb();
    const { name, sku, category_id, buy_price, sell_price, stock_qty,
            reorder_level, unit, supplier_id, expiry_date, branch_id } = req.body;

    if (!name || !sku || sell_price == null) {
      return res.status(400).json({ error: 'name, sku, and sell_price are required.' });
    }

    const result = exec(db,
      `INSERT INTO products (name, sku, category_id, buy_price, sell_price, stock_qty,
        reorder_level, unit, supplier_id, expiry_date, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, sku, category_id || null, buy_price || 0, sell_price,
       stock_qty || 0, reorder_level || 10, unit || 'pcs',
       supplier_id || null, expiry_date || null, branch_id || null]);

    res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Product created.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'SKU already exists.' });
    res.status(500).json({ error: err.message });
  }
}

async function updateProduct(req, res) {
  try {
    const db = await getDb();
    const fields = req.body;
    const allowed = ['name','sku','category_id','buy_price','sell_price','stock_qty',
                     'reorder_level','unit','supplier_id','expiry_date','is_active'];
    const sets = Object.keys(fields).filter(k => allowed.includes(k));

    if (!sets.length) return res.status(400).json({ error: 'No valid fields to update.' });

    const sql = `UPDATE products SET ${sets.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
    const result = exec(db, sql, [...sets.map(k => fields[k]), req.params.id]);

    if (!result.changes) return res.status(404).json({ error: 'Product not found.' });
    res.json({ success: true, message: 'Product updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function adjustStock(req, res) {
  try {
    const db = await getDb();
    const { adjustment, reason } = req.body; // positive = restock, negative = shrinkage

    if (adjustment == null) return res.status(400).json({ error: 'adjustment amount required.' });

    const rows = query(db, 'SELECT stock_qty FROM products WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found.' });

    const newQty = Math.max(0, rows[0].stock_qty + parseInt(adjustment));
    exec(db, "UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?",
      [newQty, req.params.id]);

    res.json({ success: true, previous_qty: rows[0].stock_qty, new_qty: newQty, adjustment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteProduct(req, res) {
  try {
    const db = await getDb();
    // Soft delete — keep the record but flag inactive
    const result = exec(db, 'UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Product not found.' });
    res.json({ success: true, message: 'Product deactivated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getCategories(req, res) {
  try {
    const db = await getDb();
    const cats = query(db, 'SELECT * FROM categories ORDER BY name');
    res.json({ success: true, data: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getStockSummary(req, res) {
  try {
    const db = await getDb();
    const summary = query(db, `
      SELECT
        COUNT(*) AS total_products,
        SUM(CASE WHEN stock_qty > reorder_level THEN 1 ELSE 0 END) AS healthy,
        SUM(CASE WHEN stock_qty > 0 AND stock_qty <= reorder_level THEN 1 ELSE 0 END) AS low,
        SUM(CASE WHEN stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date <= date('now','+7 days') THEN 1 ELSE 0 END) AS expiring_soon,
        ROUND(SUM(stock_qty * buy_price), 2) AS total_inventory_value
      FROM products WHERE is_active = 1
    `);
    res.json({ success: true, data: summary[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getProducts, getProduct, createProduct, updateProduct,
                   adjustStock, deleteProduct, getCategories, getStockSummary };
