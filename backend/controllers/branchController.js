/**
 * Module: Branch Management Controller
 * Handles CRUD operations for store branches.
 */

const { getDb, query, exec } = require('../db/database');

async function getBranches(req, res) {
  try {
    const db = await getDb();
    const branches = query(db, 'SELECT * FROM branches WHERE is_active = 1 ORDER BY id ASC');
    res.json({ success: true, count: branches.length, data: branches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createBranch(req, res) {
  try {
    const db = await getDb();
    const { name, location, phone } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Branch name is required.' });
    }

    const existing = query(db, 'SELECT id FROM branches WHERE LOWER(name) = LOWER(?)', [name.trim()]);
    if (existing.length) {
      return res.status(400).json({ error: `A branch named '${name.trim()}' already exists.` });
    }

    const result = exec(db,
      'INSERT INTO branches (name, location, phone, is_active) VALUES (?, ?, ?, 1)',
      [name.trim(), location ? location.trim() : null, phone ? phone.trim() : null]
    );

    const newBranch = query(db, 'SELECT * FROM branches WHERE id = ?', [result.lastInsertRowid])[0];

    res.status(201).json({
      success: true,
      message: 'Branch created successfully.',
      data: newBranch
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateBranch(req, res) {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { name, location, phone, is_active } = req.body;

    const existing = query(db, 'SELECT * FROM branches WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Branch not found.' });
    }

    const nameVal = name ? name.trim() : existing[0].name;
    const locVal = location !== undefined ? location : existing[0].location;
    const phoneVal = phone !== undefined ? phone : existing[0].phone;
    const activeVal = is_active !== undefined ? (is_active ? 1 : 0) : existing[0].is_active;

    exec(db,
      'UPDATE branches SET name = ?, location = ?, phone = ?, is_active = ? WHERE id = ?',
      [nameVal, locVal, phoneVal, activeVal, id]
    );

    const updated = query(db, 'SELECT * FROM branches WHERE id = ?', [id])[0];
    res.json({ success: true, message: 'Branch updated.', data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteBranch(req, res) {
  try {
    const db = await getDb();
    const { id } = req.params;

    if (parseInt(id) === 1) {
      return res.status(400).json({ error: 'Main Branch cannot be deleted.' });
    }

    const result = exec(db, 'UPDATE branches SET is_active = 0 WHERE id = ?', [id]);
    if (!result.changes) {
      return res.status(404).json({ error: 'Branch not found.' });
    }

    res.json({ success: true, message: 'Branch deactivated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBranches, createBranch, updateBranch, deleteBranch };
