/** MODULE 6: Sales Terminal Controller — Transactions & POS Checkout */

const { getDb, query, exec } = require('../db/database');
const { logAudit } = require('../utils/auditLogger');

async function processCheckout(req, res) {
  try {
    const db = await getDb();
    const { customer_id, items, discount, vat_rate, payment_method, notes } = req.body;
    let branch_id = req.body.branch_id;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    // Enforce Time & Attendance: Cashier/staff must be clocked in to process sales
    if (req.user) {
      const empRows = query(db,
        'SELECT id FROM employees WHERE (LOWER(email) = LOWER(?) OR name = ?) AND status != "terminated"',
        [req.user.email || '', req.user.name || '']
      );
      const empId = empRows.length ? empRows[0].id : null;
      if (empId) {
        const openShift = query(db,
          'SELECT id FROM time_entries WHERE employee_id = ? AND status = "open"',
          [empId]
        );
        if (!openShift.length) {
          return res.status(403).json({
            error: 'Register terminal locked. You must Clock In before processing sales transactions.',
            clock_required: true
          });
        }
      }
    }

    // Generate unique transaction reference (e.g. TXN-20260722-X9A2)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ref = `TXN-${dateStr}-${randSuffix}`;

    let subtotal = 0;
    const verifiedItems = [];
    let inferredProductBranchId = null;

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

      if (!inferredProductBranchId && prod.branch_id) {
        inferredProductBranchId = prod.branch_id;
      }

      const itemDiscount = item.discount || 0;
      const lineTotal = (prod.sell_price * item.qty) - itemDiscount;
      subtotal += lineTotal;

      verifiedItems.push({
        product_id: prod.id,
        name: prod.name,
        sku: prod.sku,
        qty: item.qty,
        unit_price: prod.sell_price,
        discount: itemDiscount,
        line_total: lineTotal,
        current_stock: prod.stock_qty,
        branch_id: prod.branch_id
      });
    }

    // Determine target branch strictly
    const finalBranchId = branch_id || inferredProductBranchId || (req.user ? req.user.branch_id : 1) || 1;

    const appliedDiscount = discount || 0;
    const rate = vat_rate !== undefined ? vat_rate : 16;
    const vat = Math.round((subtotal - appliedDiscount) * (rate / 100) * 100) / 100;
    const total = Math.max(0, subtotal - appliedDiscount + vat);
    const createdAt = new Date().toISOString();

    // Insert Main Transaction Record with explicit UTC ISO timestamp
    const txResult = exec(db,
      `INSERT INTO transactions (ref, customer_id, cashier_id, branch_id, subtotal, discount, vat, total, payment_method, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      [ref, customer_id || null, req.user ? req.user.id : null, finalBranchId,
       subtotal, appliedDiscount, vat, total, payment_method || 'cash', notes || null, createdAt]
    );

    const transactionId = txResult.lastInsertRowid;

    // Get branch name for logging
    const bRows = query(db, 'SELECT name FROM branches WHERE id = ?', [finalBranchId]);
    const branchName = bRows.length ? bRows[0].name : 'Branch Store';
    const cashierName = req.user ? req.user.name : 'Cashier';

    // Insert line items, decrement stock & log movement
    for (const vItem of verifiedItems) {
      exec(db,
        `INSERT INTO transaction_items (transaction_id, product_id, qty, unit_price, discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [transactionId, vItem.product_id, vItem.qty, vItem.unit_price, vItem.discount, vItem.line_total]
      );

      exec(db, 'UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [vItem.qty, vItem.product_id]);

      try {
        const movRef = `MOV-${Math.floor(1000 + Math.random() * 9000)}`;
        exec(db,
          `INSERT INTO stock_movements (ref, product_id, product_name, sku, movement_type, qty_change, reason, recorded_by, branch_name, branch_id)
           VALUES (?, ?, ?, ?, 'SALE', ?, ?, ?, ?, ?)`,
          [movRef, vItem.product_id, vItem.name, vItem.sku || '', -vItem.qty, `Sale Ref: ${ref}`, cashierName, branchName, finalBranchId]
        );
      } catch (movErr) {
        // Non-fatal movement log notice
      }
    }

    // Award loyalty points (1 point per 100 KES spent) if registered customer
    if (customer_id) {
      const earnedPoints = Math.floor(total / 100);
      if (earnedPoints > 0) {
        exec(db, 'UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?', [earnedPoints, customer_id]);
      }
    }

    // Audit log: Price Override or Discount check
    let hasPriceOverride = false;
    for (const vItem of verifiedItems) {
      if (vItem.discount > 0) {
        hasPriceOverride = true;
        await logAudit(req, {
          action: 'PRICE_OVERRIDE',
          entity_type: 'transaction',
          entity_id: ref,
          old_value: { catalog_price: vItem.unit_price, qty: vItem.qty },
          new_value: { discount: vItem.discount, final_line_total: vItem.line_total },
          details: `Price override/discount on '${vItem.name}' (Discount: KES ${vItem.discount}) in Sale ${ref}`,
          branch_id: finalBranchId
        });
      }
    }

    if (appliedDiscount > 0 && !hasPriceOverride) {
      await logAudit(req, {
        action: 'DISCOUNT_APPLIED',
        entity_type: 'transaction',
        entity_id: ref,
        old_value: { subtotal },
        new_value: { discount: appliedDiscount, total },
        details: `Overall transaction discount KES ${appliedDiscount} applied on Sale ${ref}`,
        branch_id: finalBranchId
      });
    }

    await logAudit(req, {
      action: 'SALE_COMPLETED',
      entity_type: 'transaction',
      entity_id: ref,
      new_value: { total, payment_method: payment_method || 'cash', item_count: verifiedItems.length },
      details: `Completed sale ${ref} (KES ${total}) via ${payment_method || 'cash'}`,
      branch_id: finalBranchId
    });

    res.status(201).json({
      success: true,
      ref,
      transaction_id: transactionId,
      branch_id: finalBranchId,
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
    let { branch_id, customer_id, payment_method, limit } = req.query;

    // If cashier or manager, enforce their assigned branch
    if (req.user && req.user.role !== 'owner' && req.user.branch_id) {
      branch_id = req.user.branch_id;
    }

    let sql = `
      SELECT t.*, u.name AS cashier_name, c.name AS customer_name, b.name AS branch_name
      FROM transactions t
      LEFT JOIN users u ON t.cashier_id = u.id
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];
    if (branch_id && branch_id !== 'all') { sql += ' AND t.branch_id = ?'; params.push(branch_id); }
    if (customer_id)                      { sql += ' AND t.customer_id = ?'; params.push(customer_id); }
    if (payment_method)                   { sql += ' AND t.payment_method = ?'; params.push(payment_method); }

    sql += ' ORDER BY t.created_at DESC';
    sql += ` LIMIT ${parseInt(limit) || 200}`;

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

async function voidTransaction(req, res) {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { reason } = req.body || {};

    const rows = query(db, 'SELECT * FROM transactions WHERE id = ? OR ref = ?', [id, id]);
    if (!rows.length) return res.status(404).json({ error: 'Transaction not found.' });

    const tx = rows[0];
    if (tx.status === 'voided') {
      return res.status(400).json({ error: 'Transaction is already voided.' });
    }

    const items = query(db, `
      SELECT ti.*, p.name AS product_name, p.sku
      FROM transaction_items ti
      LEFT JOIN products p ON ti.product_id = p.id
      WHERE ti.transaction_id = ?
    `, [tx.id]);

    const voidTime = new Date().toISOString();
    const voidedBy = req.user ? req.user.name : 'Authorized Staff';
    const voidReason = reason || 'Manager Void';

    // 1. Update status to voided
    exec(db, `
      UPDATE transactions
      SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?
      WHERE id = ?
    `, [voidTime, voidedBy, voidReason, tx.id]);

    // 2. Return stock to inventory & record stock movements
    for (const it of items) {
      if (it.product_id) {
        exec(db, 'UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?', [it.qty, it.product_id]);
        try {
          const movRef = `MOV-${Math.floor(1000 + Math.random() * 9000)}`;
          exec(db,
            `INSERT INTO stock_movements (ref, product_id, product_name, sku, movement_type, qty_change, reason, recorded_by, branch_id)
             VALUES (?, ?, ?, ?, 'VOID_RETURN', ?, ?, ?, ?)`,
            [movRef, it.product_id, it.product_name || 'Product', it.sku || '', it.qty, `Voided Txn: ${tx.ref} (${voidReason})`, voidedBy, tx.branch_id]
          );
        } catch (movErr) {}
      }
    }

    // 3. Deduct loyalty points if awarded
    if (tx.customer_id) {
      const earnedPoints = Math.floor(tx.total / 100);
      if (earnedPoints > 0) {
        exec(db, 'UPDATE customers SET loyalty_points = MAX(0, loyalty_points - ?) WHERE id = ?', [earnedPoints, tx.customer_id]);
      }
    }

    // 4. Centralized Immutable Audit Log
    await logAudit(req, {
      action: 'TRANSACTION_VOIDED',
      entity_type: 'transaction',
      entity_id: tx.ref,
      old_value: { status: tx.status, total: tx.total },
      new_value: { status: 'voided', void_reason: voidReason, voided_by: voidedBy },
      details: `Voided transaction ${tx.ref} (KES ${tx.total}) - Reason: ${voidReason}`,
      branch_id: tx.branch_id
    });

    res.json({
      success: true,
      message: `Transaction ${tx.ref} voided successfully and inventory restored.`,
      transaction: { ...tx, status: 'voided', voided_at: voidTime, voided_by: voidedBy, void_reason: voidReason }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { processCheckout, getTransactions, getTransactionDetail, voidTransaction };
