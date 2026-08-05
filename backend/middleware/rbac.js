/**
 * OpenFloat POS X — Role-Based Access Control (RBAC) Middleware
 *
 * Usage: router.delete('/:id', requireAuth, requireRole('owner','manager'), ctrl.deleteProduct)
 */

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`
      });
    }
    next();
  };
}

module.exports = { requireRole };
