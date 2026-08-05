/** Z-Reports Controller — End-of-Day Terminal Closure Reports */
const { getDb, query, exec } = require('../db/database');

async function getZReports(req, res) {
  try {
    const db = await getDb();
    const { type } = req.query;
    let sql = 'SELECT * FROM z_reports WHERE 1=1';
    const params = [];
    if (type) { sql += ' AND report_type = ?'; params.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const data = query(db, sql, params);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function generateZReport(req, res) {
  try {
    const db = await getDb();
    const { report_type, period_label, cashier_name, manager_name, branch_name } = req.body;

    // Aggregate sales data from transactions table for today / active shift
    const stats = query(db, `
      SELECT
        COALESCE(SUM(total), 0) AS total_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'mpesa' THEN total ELSE 0 END), 0) AS mpesa_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN total ELSE 0 END), 0) AS credit_sales,
        COALESCE(SUM(discount), 0) AS discounts,
        COALESCE(SUM(vat), 0) AS vat_collected,
        COALESCE(SUM(subtotal), 0) AS net_revenue
      FROM transactions
      WHERE status = 'completed'
    `)[0];

    const reportNo = 'ZREP-2026-' + Math.floor(1000 + Math.random() * 9000);
    const openingFloat = 5000;
    const closingCash = openingFloat + stats.cash_sales;

    const result = exec(db,
      `INSERT INTO z_reports (report_no, cashier_name, manager_name, branch_name, report_type, period_label, opening_float, total_sales, cash_sales, mpesa_sales, card_sales, credit_sales, discounts, vat_collected, net_revenue, closing_cash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reportNo, cashier_name || 'James Mwangi', manager_name || 'David Kamau', branch_name || 'Nairobi Main', report_type || 'cashier', period_label || 'Today', openingFloat, stats.total_sales, stats.cash_sales, stats.mpesa_sales, stats.card_sales, stats.credit_sales, stats.discounts, stats.vat_collected, stats.net_revenue, closingCash]
    );

    const report = query(db, 'SELECT * FROM z_reports WHERE id = ?', [result.lastInsertRowid])[0];
    res.status(201).json({ success: true, data: report, message: 'Z-Report generated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getZReports, generateZReport };
