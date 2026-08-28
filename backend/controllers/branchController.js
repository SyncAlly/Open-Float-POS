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

    // Also deactivate login credentials and employee records tied to this closed branch
    exec(db, 'UPDATE users SET is_active = 0 WHERE branch_id = ? AND role != "owner"', [id]);
    exec(db, 'UPDATE employees SET status = "terminated" WHERE branch_id = ?', [id]);

    res.json({ success: true, message: 'Branch deactivated and associated staff logins disabled.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/branches/performance — Owner-Exclusive comparative analytics across Sales, HR, Inventory, and Finance
 */
async function getBranchPerformance(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, `
      SELECT 
        b.id,
        b.name,
        b.location,
        b.phone,
        b.is_active,
        COALESCE(SUM(t.total), 0) AS total_revenue,
        COUNT(t.id) AS transaction_count,
        COALESCE(AVG(t.total), 0) AS avg_order_value,
        COALESCE(SUM(CASE WHEN t.created_at >= date('now', 'start of day') THEN t.total ELSE 0 END), 0) AS today_revenue,
        COALESCE(SUM(CASE WHEN t.created_at >= date('now', '-7 days') THEN t.total ELSE 0 END), 0) AS week_revenue,
        COALESCE(SUM(CASE WHEN t.created_at >= date('now', 'start of month') THEN t.total ELSE 0 END), 0) AS month_revenue,
        COALESCE(SUM(CASE WHEN t.created_at >= date('now', 'start of year') THEN t.total ELSE 0 END), 0) AS year_revenue,
        COALESCE(SUM(CASE WHEN LOWER(t.payment_method) = 'cash' THEN t.total ELSE 0 END), 0) AS cash_revenue,
        COALESCE(SUM(CASE WHEN LOWER(t.payment_method) = 'mpesa' THEN t.total ELSE 0 END), 0) AS mpesa_revenue,
        COALESCE(SUM(CASE WHEN LOWER(t.payment_method) IN ('card', 'bank') THEN t.total ELSE 0 END), 0) AS card_revenue,
        COALESCE(SUM(CASE WHEN LOWER(t.payment_method) = 'credit' THEN t.total ELSE 0 END), 0) AS credit_revenue,
        (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id) AS staff_count,
        (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.status = 'present') AS staff_present_count,
        (SELECT COALESCE(AVG(e.attendance_pct), 0) FROM employees e WHERE e.branch_id = b.id) AS avg_attendance_pct,
        (SELECT COALESCE(SUM(e.salary), 0) FROM employees e WHERE e.branch_id = b.id) AS total_payroll,
        (SELECT COUNT(*) FROM products p WHERE p.branch_id = b.id AND p.is_active = 1) AS product_count,
        (SELECT COUNT(*) FROM products p WHERE p.branch_id = b.id AND p.is_active = 1 AND p.stock_qty <= p.reorder_level) AS low_stock_count,
        (SELECT COALESCE(SUM(p.stock_qty * p.buy_price), 0) FROM products p WHERE p.branch_id = b.id AND p.is_active = 1) AS inventory_value,
        (SELECT COALESCE(SUM(c.credit_balance), 0) FROM customers c WHERE c.branch_id = b.id) AS outstanding_ar
      FROM branches b
      LEFT JOIN transactions t ON t.branch_id = b.id AND t.status = 'completed'
      WHERE b.is_active = 1
      GROUP BY b.id
      ORDER BY total_revenue DESC
    `);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBranches, createBranch, updateBranch, deleteBranch, getBranchPerformance };
