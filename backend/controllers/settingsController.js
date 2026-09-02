/** MODULE 1: Settings — Simplest module, pure key-value store */

const { getDb, query, exec } = require('../db/database');

const SENSITIVE_SETTINGS_KEYS = [
  'mpesa_consumer_key',
  'mpesa_consumer_secret',
  'mpesa_passkey',
  'smtp_password',
  'jwt_secret',
  'api_key'
];

async function getSettings(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, 'SELECT key, value FROM settings ORDER BY key');
    const isOwner = req.user && req.user.role === 'owner';
    const settings = {};

    rows.forEach(r => {
      const isSensitive = SENSITIVE_SETTINGS_KEYS.includes(r.key.toLowerCase());
      if (isSensitive && !isOwner) {
        settings[r.key] = '••••••••'; // Redact sensitive secrets for non-owners
      } else {
        settings[r.key] = r.value;
      }
    });

    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSettings(req, res) {
  try {
    const db = await getDb();
    const updates = req.body; // { key: value, key: value, ... }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object of key-value pairs.' });
    }

    Object.entries(updates).forEach(([key, value]) => {
      // Ignore redacted placeholder updates
      if (value === '••••••••') return;
      exec(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    });

    res.json({ success: true, message: `${Object.keys(updates).length} setting(s) updated.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSetting(req, res) {
  try {
    const isOwner = req.user && req.user.role === 'owner';
    const isSensitive = SENSITIVE_SETTINGS_KEYS.includes(req.params.key.toLowerCase());
    if (isSensitive && !isOwner) {
      return res.status(403).json({ error: 'Access denied. Only the Business Owner can access sensitive settings.' });
    }

    const db = await getDb();
    const rows = query(db, 'SELECT value FROM settings WHERE key = ?', [req.params.key]);
    if (!rows.length) return res.status(404).json({ error: 'Setting not found.' });
    res.json({ success: true, key: req.params.key, value: rows[0].value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getSettings, updateSettings, getSetting };
