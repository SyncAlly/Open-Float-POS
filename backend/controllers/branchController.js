/** MODULE: Branch Controller — Store Branches & Locations */

const { getDb, query, exec } = require('../db/database');

async function getBranches(req, res) {
  try {
    const db = await getDb();
    const sql = `
      SELECT b.*, 
             (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.status != 'terminated') AS employee_count,
             (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id) AS user_count
      FROM branches b
      ORDER BY b.id ASC
    `;
    const branches = query(db, sql);
    res.json({ success: true, data: branches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createBranch(req, res) {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only owners or managers can add branches.' });
    }
    const db = await getDb();
    const { name, location, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Branch name is required.' });

    const result = exec(db,
      'INSERT INTO branches (name, location, phone) VALUES (?, ?, ?)',
      [name.trim(), (location || '').trim(), (phone || '').trim()]
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Branch created.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateBranch(req, res) {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only owners or managers can edit branches.' });
    }
    const db = await getDb();
    const { name, location, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Branch name is required.' });

    const result = exec(db,
      'UPDATE branches SET name = ?, location = ?, phone = ? WHERE id = ?',
      [name.trim(), (location || '').trim(), (phone || '').trim(), req.params.id]
    );

    if (!result.changes) return res.status(404).json({ error: 'Branch not found.' });
    res.json({ success: true, message: 'Branch updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteBranch(req, res) {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can delete branches.' });
    }
    const db = await getDb();
    
    // Check if it's the default branch (ID 1)
    if (String(req.params.id) === '1') {
      return res.status(400).json({ error: 'Main Branch / HQ cannot be deleted.' });
    }

    // Reassign employees/users from this branch to Main Branch (ID 1) before deletion
    exec(db, 'UPDATE employees SET branch_id = 1 WHERE branch_id = ?', [req.params.id]);
    exec(db, 'UPDATE users SET branch_id = 1 WHERE branch_id = ?', [req.params.id]);
    exec(db, 'UPDATE products SET branch_id = 1 WHERE branch_id = ?', [req.params.id]);

    const result = exec(db, 'DELETE FROM branches WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Branch not found.' });

    res.json({ success: true, message: 'Branch deleted and associated staff reassigned to HQ.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBranches, createBranch, updateBranch, deleteBranch };
