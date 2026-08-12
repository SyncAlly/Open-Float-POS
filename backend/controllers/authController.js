/** MODULE 3: Auth Controller — Login, Logout, Me, Register */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, query, exec } = require('../db/database');

const JWT_SECRET  = process.env.JWT_SECRET || 'openfloat_secret';
const JWT_EXPIRES = '8h'; // Shift-length sessions

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const db = await getDb();
    const users = query(db,
      `SELECT u.*, b.name AS branch_name FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.email = ? AND u.is_active = 1`, [email.toLowerCase()]);

    if (!users.length) return res.status(401).json({ error: 'Invalid credentials.' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    const secret = process.env.JWT_SECRET || 'openfloat_secret';
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, branch_id: user.branch_id },
      secret,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, branch_id: user.branch_id, branch_name: user.branch_name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function me(req, res) {
  try {
    const db = await getDb();
    const users = query(db,
      `SELECT u.id, u.name, u.email, u.role, u.branch_id, u.created_at, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = ?`, [req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, data: users[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const db = await getDb();
    const users = query(db, 'SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(current_password, users[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect.' });

    const newHash = await bcrypt.hash(new_password, 10);
    exec(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function register(req, res) {
  // Only owner, manager, or HR can create new user accounts
  if (req.user.role !== 'owner' && req.user.role !== 'manager' && req.user.role !== 'hr') {
    return res.status(403).json({ error: 'Only owners, managers, or HR officers can register new users.' });
  }
  try {
    const { name, email, password, role, branch_id } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required.' });

    const hash = await bcrypt.hash(password, 10);
    const db = await getDb();
    const result = exec(db,
      'INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, ?, ?)',
      [name, email.toLowerCase(), hash, role || 'cashier', branch_id || null]);

    res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'User created.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered.' });
    res.status(500).json({ error: err.message });
  }
}

module.exports = { login, me, changePassword, register };
