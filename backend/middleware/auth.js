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

  // Reject demo tokens — they must log in with a real account
  if (token.startsWith('demo_')) {
    return res.status(401).json({ error: 'Demo session expired. Please sign in.' });
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
