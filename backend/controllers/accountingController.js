/** MODULE 8: Accounting Controller — Cashflow, Ledgers (AR/AP), Financial Stats */

const { getDb, query, exec } = require('../db/database');
const { logAudit } = require('../utils/auditLogger');

async function getFinancialOverview(req, res) {
  try {
    const db = await getDb();
    const { branch_id } = req.query;
    const isBranchScoped = branch_id && branch_id !== 'all';

    // Total sales revenue
    const revSql = isBranchScoped
      ? "SELECT COALESCE(SUM(total), 0) AS total_revenue FROM transactions WHERE status = 'completed' AND branch_id = ?"
      : "SELECT COALESCE(SUM(total), 0) AS total_revenue FROM transactions WHERE status = 'completed'";
    const revRow = query(db, revSql, isBranchScoped ? [branch_id] : []);
    const totalRevenue = revRow[0].total_revenue;

    // Total inventory COGS value
    const cogsSql = isBranchScoped
      ? "SELECT COALESCE(SUM(stock_qty * buy_price), 0) AS total_cogs FROM products WHERE is_active = 1 AND (branch_id = ? OR branch_id IS NULL)"
      : "SELECT COALESCE(SUM(stock_qty * buy_price), 0) AS total_cogs FROM products WHERE is_active = 1";
    const cogsRow = query(db, cogsSql, isBranchScoped ? [branch_id] : []);
    const totalCOGS = cogsRow[0].total_cogs;

    // Total recorded expenses from journal entries
    const expSql = isBranchScoped
      ? "SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM journal_entries WHERE type = 'expense' AND (branch_id = ? OR branch_id IS NULL)"
      : "SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM journal_entries WHERE type = 'expense'";
    const expRow = query(db, expSql, isBranchScoped ? [branch_id] : []);
    const totalExpenses = expRow[0].total_expenses;

    const netProfit = totalRevenue - (totalExpenses + (totalRevenue * 0.4)); // Estimated gross margin basis

    // Outstanding Accounts Receivable (AR) from customer credits
    const arSql = isBranchScoped
      ? "SELECT COALESCE(SUM(credit_balance), 0) AS total_ar FROM customers WHERE (branch_id = ? OR branch_id IS NULL)"
      : "SELECT COALESCE(SUM(credit_balance), 0) AS total_ar FROM customers";
    const arRow = query(db, arSql, isBranchScoped ? [branch_id] : []);

    res.json({
      success: true,
      data: {
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_profit: Math.round(netProfit * 100) / 100,
        outstanding_ar: arRow[0].total_ar,
        inventory_cogs_value: totalCOGS
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getJournalEntries(req, res) {
  try {
    const db = await getDb();
    const { type, category, branch_id } = req.query;

    let sql = 'SELECT j.*, b.name AS branch_name FROM journal_entries j LEFT JOIN branches b ON j.branch_id = b.id WHERE 1=1';
    const params = [];
    if (branch_id && branch_id !== 'all') { sql += ' AND j.branch_id = ?'; params.push(branch_id); }
    if (type)     { sql += ' AND j.type = ?'; params.push(type); }
    if (category) { sql += ' AND j.category = ?'; params.push(category); }

    sql += ' ORDER BY j.created_at DESC';
    res.json({ success: true, count: query(db, sql, params).length, data: query(db, sql, params) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createJournalEntry(req, res) {
  try {
    const db = await getDb();
    const { type, category, description, amount, branch_id } = req.body;

    if (!type || !description || !amount) {
      return res.status(400).json({ error: 'type, description, amount are required.' });
    }

    const ref = `JE-${Math.floor(1000 + Math.random() * 9000)}`;
    const result = exec(db,
      `INSERT INTO journal_entries (ref, type, category, description, amount, branch_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ref, type, category || 'general', description, amount, branch_id || null, req.user ? req.user.id : null]
    );

    logAudit(req, {
      action: 'JOURNAL_ENTRY_CREATED',
      entity_type: 'accounting',
      entity_id: ref,
      new_value: { type, category: category || 'general', description, amount, branch_id: branch_id || null },
      details: `Recorded journal entry ${ref}: [${type.toUpperCase()}] ${description} - KES ${amount}`,
      branch_id: branch_id || null
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid, ref, message: 'Journal entry recorded.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getARAPLedgers(req, res) {
  try {
    const db = await getDb();
    const { branch_id } = req.query;
    const arSql = branch_id && branch_id !== 'all'
      ? 'SELECT id, name, credit_balance AS amount_owed, phone FROM customers WHERE credit_balance > 0 AND branch_id = ? ORDER BY credit_balance DESC'
      : 'SELECT id, name, credit_balance AS amount_owed, phone FROM customers WHERE credit_balance > 0 ORDER BY credit_balance DESC';
    const apSql = branch_id && branch_id !== 'all'
      ? "SELECT id, ref, total_value AS amount_owed, created_at FROM purchase_requests WHERE status = 'approved' AND branch_id = ? ORDER BY total_value DESC"
      : "SELECT id, ref, total_value AS amount_owed, created_at FROM purchase_requests WHERE status = 'approved' ORDER BY total_value DESC";
    const bParams = branch_id && branch_id !== 'all' ? [branch_id] : [];

    const ar = query(db, arSql, bParams);
    const ap = query(db, apSql, bParams);

    res.json({
      success: true,
      accounts_receivable: ar,
      accounts_payable: ap
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getFinancialOverview, getJournalEntries, createJournalEntry, getARAPLedgers };
