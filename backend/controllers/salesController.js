/** MODULE 6: Sales Terminal Controller — Transactions & POS Checkout */

const { getDb, query, exec } = require('../db/database');

async function processCheckout(req, res) {
  try {
    const db = await getDb();
    const { customer_id, items, discount, vat_rate, payment_method, notes, branch_id } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    // Generate unique transaction reference (e.g. TXN-20260722-X9A2)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = `TXN-${dateStr}-${randSuffix}`;

    let subtotal = 0;
    const verifiedItems = [];

    // Verify product availability & price integrity
    for (const item of items) {
      const prodRows = query(db, 'SELECT * FROM products WHERE id = ? AND is_active = 1', [item.product_id]);
      if (!prodRows.length) {
        return res.status(400).json({ error: `Product ID ${item.product_id} not found or inactive.` });
      }
      const prod = prodRows[0];
      if (prod.stock_qty < item.qty) {
        return res.status(400).json({ error: `Insufficient stock for '${prod.name}'. In stock: ${prod.stock_qty}, requested: ${item.qty}` });
      }

      const itemDiscount = item.discount || 0;
      const lineTotal = (prod.sell_price * item.qty) - itemDiscount;
      subtotal += lineTotal;

      verifiedItems.push({
        product_id: prod.id,
        qty: item.qty,
        unit_price: prod.sell_price,
        discount: itemDiscount,
        line_total: lineTotal,
        current_stock: prod.stock_qty
      });
    }

    const appliedDiscount = discount || 0;
    const rate = vat_rate !== undefined ? vat_rate : 16;
    const vat = Math.round((subtotal - appliedDiscount) * (rate / 100) * 100) / 100;
    const total = Math.max(0, subtotal - appliedDiscount + vat);

    // Insert Main Transaction Record
    const txResult = exec(db,
      `INSERT INTO transactions (ref, customer_id, cashier_id, branch_id, subtotal, discount, vat, total, payment_method, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [ref, customer_id || null, req.user ? req.user.id : null, branch_id || (req.user ? req.user.branch_id : 1),
       subtotal, appliedDiscount, vat, total, payment_method || 'cash', notes || null]
    );

    const transactionId = txResult.lastInsertRowid;

    // Insert line items & decrement stock
    for (const vItem of verifiedItems) {
      exec(db,
        `INSERT INTO transaction_items (transaction_id, product_id, qty, unit_price, discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [transactionId, vItem.product_id, vItem.qty, vItem.unit_price, vItem.discount, vItem.line_total]
      );

      exec(db, 'UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [vItem.qty, vItem.product_id]);
    }

    // Award loyalty points (1 point per 100 KES spent) if registered customer
    if (customer_id) {
      const earnedPoints = Math.floor(total / 100);
      if (earnedPoints > 0) {
        exec(db, 'UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?', [earnedPoints, customer_id]);
      }
    }

    res.status(201).json({
      success: true,
      ref,
      transaction_id: transactionId,
      subtotal,
      discount: appliedDiscount,
      vat,
      total,
      payment_method: payment_method || 'cash',
      created_at: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTransactions(req, res) {
  try {
    const db = await getDb();
    const { branch_id, customer_id, payment_method, limit } = req.query;

    let sql = `
      SELECT t.*, u.name AS cashier_name, c.name AS customer_name, b.name AS branch_name
      FROM transactions t
      LEFT JOIN users u ON t.cashier_id = u.id
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];
    if (branch_id)      { sql += ' AND t.branch_id = ?'; params.push(branch_id); }
    if (customer_id)    { sql += ' AND t.customer_id = ?'; params.push(customer_id); }
    if (payment_method) { sql += ' AND t.payment_method = ?'; params.push(payment_method); }

    sql += ' ORDER BY t.created_at DESC';
    sql += ` LIMIT ${parseInt(limit) || 50}`;

    const txs = query(db, sql, params);
    res.json({ success: true, count: txs.length, data: txs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTransactionDetail(req, res) {
  try {
    const db = await getDb();
    const rows = query(db,
      `SELECT t.*, u.name AS cashier_name, c.name AS customer_name, b.name AS branch_name
       FROM transactions t
       LEFT JOIN users u ON t.cashier_id = u.id
       LEFT JOIN customers c ON t.customer_id = c.id
       LEFT JOIN branches b ON t.branch_id = b.id
       WHERE t.id = ? OR t.ref = ?`, [req.params.id, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Transaction not found.' });

    const tx = rows[0];
    const items = query(db,
      `SELECT ti.*, p.name AS product_name, p.sku
       FROM transaction_items ti
       JOIN products p ON ti.product_id = p.id
       WHERE ti.transaction_id = ?`, [tx.id]);

    tx.items = items;
    res.json({ success: true, data: tx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { processCheckout, getTransactions, getTransactionDetail };
