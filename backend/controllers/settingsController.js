/** MODULE 1: Settings — Simplest module, pure key-value store */

const { getDb, query, exec } = require('../db/database');

async function getSettings(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, 'SELECT key, value FROM settings ORDER BY key');
    // Convert array of {key,value} rows into a flat object for easy consumption
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
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
      exec(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    });

    res.json({ success: true, message: `${Object.keys(updates).length} setting(s) updated.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSetting(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, 'SELECT value FROM settings WHERE key = ?', [req.params.key]);
    if (!rows.length) return res.status(404).json({ error: 'Setting not found.' });
    res.json({ success: true, key: req.params.key, value: rows[0].value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getSettings, updateSettings, getSetting };
