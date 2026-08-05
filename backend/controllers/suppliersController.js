/** Suppliers Controller — Vendor Management CRUD */
const { getDb, query, exec } = require('../db/database');

async function getSuppliers(req, res) {
  try {
    const db = await getDb();
    const { category, search } = req.query;
    let sql = 'SELECT * FROM suppliers WHERE is_active = 1';
    const params = [];

    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (search)   { sql += ' AND (name LIKE ? OR contact_name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    sql += ' ORDER BY name ASC';
    const data = query(db, sql, params);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSupplier(req, res) {
  try {
    const db = await getDb();
    const { name, category, contact_name, phone, email, rating } = req.body;
    if (!name) return res.status(400).json({ error: 'Supplier name is required.' });

    const result = exec(db,
      `INSERT INTO suppliers (name, category, contact_name, phone, email, rating)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, category || 'General', contact_name || '', phone || '', email || '', rating || 85]
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Supplier created.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSupplier(req, res) {
  try {
    const db = await getDb();
    const { name, category, contact_name, phone, email, rating } = req.body;
    const result = exec(db,
      `UPDATE suppliers SET name=?, category=?, contact_name=?, phone=?, email=?, rating=? WHERE id=?`,
      [name, category, contact_name, phone, email, rating, req.params.id]
    );
    if (!result.changes) return res.status(404).json({ error: 'Supplier not found.' });
    res.json({ success: true, message: 'Supplier updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteSupplier(req, res) {
  try {
    const db = await getDb();
    const result = exec(db, 'UPDATE suppliers SET is_active = 0 WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Supplier not found.' });
    res.json({ success: true, message: 'Supplier deactivated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getSuppliers, createSupplier, updateSupplier, deleteSupplier };
