/**
 * JWT Authentication Middleware
 * Attaches req.user to validated requests.
 */

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // Handle demo token fallback in dev/testing
  if (token.startsWith('demo_')) {
    req.user = { id: 1, name: 'Admin / Owner', email: 'owner@openfloat.com', role: 'owner', branch_id: 1 };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'openfloat_secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth };
