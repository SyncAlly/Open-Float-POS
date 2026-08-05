/** MODULE 9: Logistics Controller — Dispatch & Fleet Tracking */

const { getDb, query, exec } = require('../db/database');

async function getDeliveries(req, res) {
  try {
    const db = await getDb();
    const { status, branch_id } = req.query;

    let sql = `
      SELECT d.*, c.name AS customer_name, b.name AS branch_name
      FROM deliveries d
      LEFT JOIN customers c ON d.customer_id = c.id
      LEFT JOIN branches b ON d.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];
    if (status)    { sql += ' AND d.status = ?'; params.push(status); }
    if (branch_id) { sql += ' AND d.branch_id = ?'; params.push(branch_id); }

    sql += ' ORDER BY d.created_at DESC';
    res.json({ success: true, count: query(db, sql, params).length, data: query(db, sql, params) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createDelivery(req, res) {
  try {
    const db = await getDb();
    const { customer_id, driver_name, van_number, origin, destination, eta, branch_id } = req.body;

    if (!destination) return res.status(400).json({ error: 'Destination is required.' });

    const ref = `DEL-${Math.floor(1000 + Math.random() * 9000)}`;
    const result = exec(db,
      `INSERT INTO deliveries (ref, customer_id, driver_name, van_number, origin, destination, status, eta, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [ref, customer_id || null, driver_name || null, van_number || null,
       origin || 'Main Warehouse', destination, eta || '30 min', branch_id || 1]
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, ref, message: 'Delivery dispatched.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateDeliveryStatus(req, res) {
  try {
    const db = await getDb();
    const { status, driver_name, van_number, eta } = req.body;

    if (!['pending', 'in_transit', 'delayed', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid delivery status.' });
    }

    let sql = 'UPDATE deliveries SET status = ?, updated_at = datetime("now")';
    const params = [status];

    if (driver_name) { sql += ', driver_name = ?'; params.push(driver_name); }
    if (van_number)  { sql += ', van_number = ?'; params.push(van_number); }
    if (eta)         { sql += ', eta = ?'; params.push(eta); }

    sql += ' WHERE id = ? OR ref = ?';
    params.push(req.params.id, req.params.id);

    const result = exec(db, sql, params);
    if (!result.changes) return res.status(404).json({ error: 'Delivery record not found.' });

    res.json({ success: true, message: `Delivery status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getDeliveries, createDelivery, updateDeliveryStatus };
