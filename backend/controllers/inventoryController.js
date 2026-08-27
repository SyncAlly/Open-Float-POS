const { getDb, query, exec } = require('../db/database');
const { downloadAndSaveImage } = require('../utils/imageDownloader');

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

async function getOrCreateCategoryId(db, catId, catName) {
  const name = (catName || '').trim();
  if (name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('cat-' + Date.now());
    const existing = query(db, 'SELECT id FROM categories WHERE LOWER(name) = LOWER(?) OR LOWER(slug) = LOWER(?)', [name, slug]);
    if (existing && existing.length > 0) {
      return existing[0].id;
    }
    const catRes = exec(db, 'INSERT INTO categories (name, slug) VALUES (?, ?)', [name, slug]);
    return catRes.lastInsertRowid;
  }
  if (catId && catId !== 'NEW_CATEGORY' && !isNaN(parseInt(catId))) {
    return parseInt(catId);
  }
  return null;
}

async function createProduct(req, res) {
  try {
    const db = await getDb();
    const { name, sku, category_id, category_name, new_category, buy_price, sell_price, stock_qty,
            reorder_level, unit, supplier_id, expiry_date, branch_id, image_url } = req.body;

    if (!name || !sku || sell_price == null) {
      return res.status(400).json({ error: 'name, sku, and sell_price are required.' });
    }

    const resolvedCatId = await getOrCreateCategoryId(db, category_id, new_category || category_name);
    // Fetch and save image locally into ./uploads/products/
    const localImagePath = image_url ? await downloadAndSaveImage(image_url, sku) : null;

    const result = exec(db,
      `INSERT INTO products (name, sku, category_id, buy_price, sell_price, stock_qty,
        reorder_level, unit, supplier_id, expiry_date, branch_id, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, sku, resolvedCatId, buy_price || 0, sell_price,
       stock_qty || 0, reorder_level || 10, unit || 'pcs',
       supplier_id || null, expiry_date || null, branch_id || null, localImagePath]);

    res.status(201).json({ success: true, id: result.lastInsertRowid, category_id: resolvedCatId, message: 'Product created.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'SKU already exists.' });
    res.status(500).json({ error: err.message });
  }
}

async function updateProduct(req, res) {
  try {
    const db = await getDb();
    const fields = { ...req.body };

    if (fields.new_category || fields.category_name) {
      fields.category_id = await getOrCreateCategoryId(db, fields.category_id, fields.new_category || fields.category_name);
      delete fields.new_category;
      delete fields.category_name;
    }

    if (fields.image_url !== undefined && fields.image_url) {
      const skuForName = fields.sku || ('prod_' + req.params.id);
      fields.image_url = await downloadAndSaveImage(fields.image_url, skuForName);
    }

    const allowed = ['name','sku','category_id','buy_price','sell_price','stock_qty',
                     'reorder_level','unit','supplier_id','expiry_date','is_active','image_url'];
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
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function bulkDeleteProducts(req, res) {
  try {
    const db = await getDb();
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids array is required.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const result = exec(db, `UPDATE products SET is_active = 0 WHERE id IN (${placeholders})`, ids);
    res.json({ success: true, count: result.changes, message: `${result.changes} product(s) deleted.` });
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

async function createCategory(req, res) {
  try {
    const db = await getDb();
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    const catName = name.trim();
    const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('cat-' + Date.now());

    const existing = query(db, 'SELECT * FROM categories WHERE LOWER(name) = LOWER(?) OR LOWER(slug) = LOWER(?)', [catName, slug]);
    if (existing && existing.length > 0) {
      return res.json({ success: true, data: existing[0], message: 'Category already exists.' });
    }

    const result = exec(db, 'INSERT INTO categories (name, slug) VALUES (?, ?)', [catName, slug]);
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid, name: catName, slug }, message: 'Category created.' });
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
                   adjustStock, deleteProduct, bulkDeleteProducts, getCategories, createCategory, getStockSummary };
