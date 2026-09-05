/**
 * OpenFloat POS X — Centralized Audit Logger Utility
 * 
 * Provides automated logging for critical security events and business mutations
 * (price overrides, stock adjustments, voided transactions, user role changes, etc.).
 */

const { getDb, exec, query } = require('../db/database');

/**
 * Log a critical action into the `audit_logs` table.
 * 
 * @param {object} req - Express request object (contains req.user, req.ip, etc.)
 * @param {object} options
 * @param {string} options.action - Action identifier (e.g., 'PRICE_OVERRIDE', 'STOCK_ADJUSTMENT', 'TRANSACTION_VOIDED', 'USER_ROLE_CHANGED')
 * @param {string} options.entity_type - Entity category ('product', 'transaction', 'user', 'role', 'accounting', 'customer', 'settings', 'inventory')
 * @param {string|number} [options.entity_id] - Target ID or reference code
 * @param {*} [options.old_value] - Previous state or value
 * @param {*} [options.new_value] - Updated state or value
 * @param {string} [options.details] - Context description
 * @param {number} [options.branch_id] - Associated branch ID
 */
async function logAudit(req, { action, entity_type, entity_id = null, old_value = null, new_value = null, details = null, branch_id = null }) {
  try {
    const db = await getDb();
    const user = req?.user || {};
    const userId = user.id || null;
    const userName = user.name || 'System / Unauthenticated';
    const userRole = user.role || 'unknown';
    const effectiveBranchId = branch_id || user.branch_id || 1;

    let clientIp = 'unknown';
    if (req) {
      clientIp = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
      if (typeof clientIp === 'string' && clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
      }
    }

    const formatVal = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'object') {
        try {
          return JSON.stringify(v);
        } catch (e) {
          return String(v);
        }
      }
      return String(v);
    };

    const oldValStr = formatVal(old_value);
    const newValStr = formatVal(new_value);

    exec(db, `
      INSERT INTO audit_logs (user_id, user_name, user_role, action, entity_type, entity_id, old_value, new_value, details, branch_id, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      userId,
      userName,
      userRole,
      String(action).toUpperCase(),
      String(entity_type).toLowerCase(),
      entity_id ? String(entity_id) : null,
      oldValStr,
      newValStr,
      details || null,
      effectiveBranchId,
      clientIp
    ]);
  } catch (err) {
    console.error('[AuditLogger Error]: Failed to write audit record:', err.message);
  }
}

/**
 * Controller endpoint: GET /api/audit-logs
 * Retrieves paginated audit logs with optional filters (action, entity_type, user_id, branch_id, search).
 */
async function getAuditLogs(req, res) {
  try {
    const db = await getDb();
    const { action, entity_type, user_id, branch_id, search, limit = 100, page = 1 } = req.query;

    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (action) {
      sql += ' AND action = ?';
      params.push(String(action).toUpperCase());
    }
    if (entity_type) {
      sql += ' AND entity_type = ?';
      params.push(String(entity_type).toLowerCase());
    }
    if (user_id) {
      sql += ' AND user_id = ?';
      params.push(user_id);
    }
    if (branch_id && branch_id !== 'all') {
      sql += ' AND branch_id = ?';
      params.push(branch_id);
    } else if (req.user && req.user.role !== 'owner' && req.user.branch_id) {
      sql += ' AND branch_id = ?';
      params.push(req.user.branch_id);
    }
    if (search) {
      sql += ' AND (user_name LIKE ? OR action LIKE ? OR details LIKE ? OR entity_id LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ' ORDER BY id DESC';

    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const pageNum = Math.max(1, parseInt(page) || 1);
    const offset = (pageNum - 1) * limitNum;

    const logsSql = `${sql} LIMIT ${limitNum} OFFSET ${offset}`;
    const logs = query(db, logsSql, params);

    // Get count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1';
    const countParams = [];
    if (action) { countSql += ' AND action = ?'; countParams.push(String(action).toUpperCase()); }
    if (entity_type) { countSql += ' AND entity_type = ?'; countParams.push(String(entity_type).toLowerCase()); }
    if (user_id) { countSql += ' AND user_id = ?'; countParams.push(user_id); }
    if (branch_id && branch_id !== 'all') { countSql += ' AND branch_id = ?'; countParams.push(branch_id); }
    else if (req.user && req.user.role !== 'owner' && req.user.branch_id) { countSql += ' AND branch_id = ?'; countParams.push(req.user.branch_id); }
    if (search) {
      countSql += ' AND (user_name LIKE ? OR action LIKE ? OR details LIKE ? OR entity_id LIKE ?)';
      const s = `%${search}%`;
      countParams.push(s, s, s, s);
    }

    const totalRow = query(db, countSql, countParams)[0];

    res.json({
      success: true,
      count: logs.length,
      data: logs,
      pagination: {
        total: totalRow ? totalRow.total : logs.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil((totalRow ? totalRow.total : logs.length) / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  logAudit,
  getAuditLogs
};
