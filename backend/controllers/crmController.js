/** MODULE 5: CRM Controller — Customer relationships & loyalty tracking */

const { getDb, query, exec } = require('../db/database');

async function getCustomers(req, res) {
  try {
    const db = await getDb();
    const { segment, search } = req.query;
    let sql = `
      SELECT c.*, b.name AS branch_name,
             (SELECT COUNT(*) FROM transactions t WHERE t.customer_id = c.id) AS total_orders,
             COALESCE((SELECT SUM(total) FROM transactions t WHERE t.customer_id = c.id), 0) AS total_spent
      FROM customers c
      LEFT JOIN branches b ON c.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];
    if (segment) { sql += ' AND c.segment = ?'; params.push(segment); }
    if (search)  { sql += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    sql += ' ORDER BY total_spent DESC';
    res.json({ success: true, count: query(db, sql, params).length, data: query(db, sql, params) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getCustomer(req, res) {
  try {
    const db = await getDb();
    const rows = query(db,
      `SELECT c.*, b.name AS branch_name,
              (SELECT COUNT(*) FROM transactions t WHERE t.customer_id = c.id) AS total_orders,
              COALESCE((SELECT SUM(total) FROM transactions t WHERE t.customer_id = c.id), 0) AS total_spent
       FROM customers c
       LEFT JOIN branches b ON c.branch_id = b.id
       WHERE c.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Customer not found.' });

    // Include recent transaction history for this customer
    const history = query(db, 'SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10', [req.params.id]);
    rows[0].recent_transactions = history;

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createCustomer(req, res) {
  try {
    const db = await getDb();
    const { name, phone, email, credit_limit, segment, branch_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });

    const result = exec(db,
      `INSERT INTO customers (name, phone, email, credit_limit, segment, branch_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, phone || null, email || null, credit_limit || 0, segment || 'regular', branch_id || null]);

    res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Customer created.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Phone number already registered.' });
    res.status(500).json({ error: err.message });
  }
}

async function updateCustomer(req, res) {
  try {
    const db = await getDb();
    const allowed = ['name', 'phone', 'email', 'loyalty_points', 'credit_limit', 'credit_balance', 'segment', 'branch_id'];
    const fields = req.body;
    const sets = Object.keys(fields).filter(k => allowed.includes(k));
    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided.' });

    const sql = `UPDATE customers SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    const result = exec(db, sql, [...sets.map(k => fields[k]), req.params.id]);

    if (!result.changes) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ success: true, message: 'Customer profile updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function redeemPoints(req, res) {
  try {
    const db = await getDb();
    const { points } = req.body;
    if (!points || points <= 0) return res.status(400).json({ error: 'Points amount required.' });

    const rows = query(db, 'SELECT loyalty_points FROM customers WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Customer not found.' });

    if (rows[0].loyalty_points < points) {
      return res.status(400).json({ error: `Insufficient points balance. Current points: ${rows[0].loyalty_points}` });
    }

    const newBalance = rows[0].loyalty_points - points;
    exec(db, 'UPDATE customers SET loyalty_points = ? WHERE id = ?', [newBalance, req.params.id]);

    res.json({ success: true, redeemed: points, remaining_points: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getCRMSummary(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, `
      SELECT
        COUNT(*) AS total_customers,
        SUM(CASE WHEN loyalty_points > 0 THEN 1 ELSE 0 END) AS loyalty_members,
        SUM(CASE WHEN credit_balance > 0 THEN 1 ELSE 0 END) AS credit_accounts,
        ROUND(SUM(credit_balance), 2) AS total_debt_owed
      FROM customers
    `);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getCustomers, getCustomer, createCustomer, updateCustomer, redeemPoints, getCRMSummary };
