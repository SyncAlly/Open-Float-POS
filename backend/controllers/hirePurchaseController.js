/** Hire Purchase Controller — Installment contracts and repayments */
const { getDb, query, exec } = require('../db/database');

async function getAgreements(req, res) {
  try {
    const db = await getDb();
    const { status, search } = req.query;
    let sql = 'SELECT * FROM hire_purchase WHERE 1=1';
    const params = [];

    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (search) { sql += ' AND (customer_name LIKE ? OR item_name LIKE ? OR ref LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    sql += ' ORDER BY created_at DESC';
    const data = query(db, sql, params);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createAgreement(req, res) {
  try {
    const db = await getDb();
    const { customer_name, customer_phone, item_name, total_value, down_payment, monthly_instalment, next_due } = req.body;
    if (!customer_name || !item_name || total_value == null || down_payment == null) {
      return res.status(400).json({ error: 'customer_name, item_name, total_value, down_payment are required.' });
    }

    const ref = 'HP-2026-' + Math.floor(100 + Math.random() * 900);
    const balance = total_value - down_payment;
    const result = exec(db,
      `INSERT INTO hire_purchase (ref, customer_name, customer_phone, item_name, total_value, down_payment, monthly_instalment, paid_instalments, balance, next_due, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active')`,
      [ref, customer_name, customer_phone || '', item_name, total_value, down_payment, monthly_instalment || 0, balance, next_due || '2026-09-01']
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, ref, message: 'Agreement created.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function recordPayment(req, res) {
  try {
    const db = await getDb();
    const { agreement_id, amount, payment_mode, receipt_ref } = req.body;
    if (!agreement_id || !amount) {
      return res.status(400).json({ error: 'agreement_id and amount are required.' });
    }

    const agreement = query(db, 'SELECT * FROM hire_purchase WHERE id = ?', [agreement_id])[0];
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });

    const newBalance = Math.max(0, agreement.balance - amount);
    const newPaidCount = agreement.paid_instalments + 1;
    const newStatus = newBalance === 0 ? 'completed' : agreement.status;

    exec(db, 'UPDATE hire_purchase SET balance = ?, paid_instalments = ?, status = ? WHERE id = ?',
      [newBalance, newPaidCount, newStatus, agreement_id]);

    const recBy = req.user ? req.user.name : 'System User';
    exec(db,
      `INSERT INTO hire_purchase_payments (agreement_id, amount, payment_mode, receipt_ref, recorded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [agreement_id, amount, payment_mode || 'M-Pesa', receipt_ref || 'REC-' + Date.now(), recBy]
    );

    res.json({ success: true, new_balance: newBalance, status: newStatus, message: 'Payment recorded.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAgreements, createAgreement, recordPayment };
