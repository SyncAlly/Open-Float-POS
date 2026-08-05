/** Services Controller — Services Catalog CRUD */
const { getDb, query, exec } = require('../db/database');

async function getServices(req, res) {
  try {
    const db = await getDb();
    const { category, search } = req.query;
    let sql = 'SELECT * FROM services WHERE is_active = 1';
    const params = [];

    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (search)   { sql += ' AND (name LIKE ? OR code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    sql += ' ORDER BY code ASC';
    const data = query(db, sql, params);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createService(req, res) {
  try {
    const db = await getDb();
    const { code, name, category, unit, price, vat_applicable, available_at } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ error: 'Service name and price are required.' });
    }

    const sCode = code || 'SRV-' + Math.floor(100 + Math.random() * 900);
    const result = exec(db,
      `INSERT INTO services (code, name, category, unit, price, vat_applicable, available_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sCode, name, category || 'General', unit || 'Per Session', price, vat_applicable ?? 1, available_at || 'All Branches']
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, code: sCode, message: 'Service added.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateService(req, res) {
  try {
    const db = await getDb();
    const { name, category, unit, price, vat_applicable, available_at } = req.body;
    const result = exec(db,
      `UPDATE services SET name=?, category=?, unit=?, price=?, vat_applicable=?, available_at=? WHERE id=?`,
      [name, category, unit, price, vat_applicable, available_at, req.params.id]
    );
    if (!result.changes) return res.status(404).json({ error: 'Service not found.' });
    res.json({ success: true, message: 'Service updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteService(req, res) {
  try {
    const db = await getDb();
    const result = exec(db, 'UPDATE services SET is_active = 0 WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Service not found.' });
    res.json({ success: true, message: 'Service deactivated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getServices, createService, updateService, deleteService };
