/**
 * JWT Authentication Middleware
 * Attaches req.user to validated requests.
 */

const jwt = require('jsonwebtoken');
const { getJwtSecret, isProduction } = require('../utils/security');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // Allow demo tokens only in non-production environments.
  if (!isProduction() && token.startsWith('demo_')) {
    const role = token.replace('demo_', '').toLowerCase();
    const validRoles = ['owner', 'manager', 'cashier', 'hr', 'accountant'];
    const assignedRole = validRoles.includes(role) ? role : 'owner';
    req.user = {
      id: assignedRole === 'owner' ? 1 : 3,
      name: 'Demo ' + assignedRole.charAt(0).toUpperCase() + assignedRole.slice(1),
      email: assignedRole + '@openfloat.com',
      role: assignedRole,
      branch_id: 1
    };
    return next();
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth };
