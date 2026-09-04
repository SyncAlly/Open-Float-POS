/**
 * OpenFloat POS X — Role-Based Access Control (RBAC) Middleware
 *
 * Usage: router.delete('/:id', requireAuth, requireRole('owner','manager'), ctrl.deleteProduct)
 * Custom roles are resolved to their base_role before comparison.
 */

const { getDb, query } = require('../db/database');

const SYSTEM_ROLES = new Set(['owner', 'manager', 'cashier', 'hr', 'accountant']);

async function resolveBaseRole(roleName) {
  if (!roleName) return 'cashier';
  const lower = roleName.toLowerCase();
  if (SYSTEM_ROLES.has(lower)) return lower;
  // Custom role: look up base_role in DB
  try {
    const db = await getDb();
    const rows = query(db, `SELECT base_role FROM custom_roles WHERE LOWER(name) = ?`, [lower]);
    if (rows.length) return rows[0].base_role;
  } catch (_) {}
  return 'cashier'; // safe fallback
}

function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const userRole = (req.user.role || '').toLowerCase();
    // Fast path: system role exact match
    if (roles.includes(userRole)) return next();
    // Custom role: resolve to base_role and compare
    const base = await resolveBaseRole(userRole);
    if (roles.includes(base)) return next();
    return res.status(403).json({
      error: `Access denied. Required: ${roles.join(' or ')}. Your role: ${req.user.role}`
    });
  };
}

module.exports = { requireRole };
