/** MODULE: Roles & Permissions Controller */

const { getDb, query, exec } = require('../db/database');
const { logAudit } = require('../utils/auditLogger');

const SYSTEM_ROLE_NAMES = ['owner', 'manager', 'cashier', 'hr', 'accountant', 'hr officer'];

async function getRoles(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, 'SELECT * FROM custom_roles ORDER BY is_system DESC, name ASC');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function createRole(req, res) {
  try {
    const { name, description, base_role, permissions } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Role name is required.' });
    if (SYSTEM_ROLE_NAMES.includes(name.trim().toLowerCase())) {
      return res.status(400).json({ error: name.trim() + ' is a reserved system role name.' });
    }
    if (!['manager','cashier','hr','accountant'].includes(base_role)) {
      return res.status(400).json({ error: 'Invalid base_role. Must be manager, cashier, hr, or accountant.' });
    }
    const db = await getDb();
    const permsJson = typeof permissions === 'object' ? JSON.stringify(permissions) : (permissions || '{}');
    const result = exec(db,
      'INSERT INTO custom_roles (name, description, base_role, permissions, is_system) VALUES (?, ?, ?, ?, 0)',
      [name.trim(), description || '', base_role, permsJson]
    );

    logAudit(req, {
      action: 'ROLE_CREATED',
      entity_type: 'role',
      entity_id: result.lastInsertRowid,
      new_value: { name: name.trim(), base_role, permissions: permsJson },
      details: `Custom role "${name.trim()}" created based on ${base_role}`
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A role with that name already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
}

async function updateRole(req, res) {
  try {
    const db = await getDb();
    const existing = query(db, 'SELECT * FROM custom_roles WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Role not found.' });
    if (existing[0].is_system) return res.status(403).json({ error: 'System roles cannot be modified.' });

    const { name, description, base_role, permissions } = req.body;
    if (name && SYSTEM_ROLE_NAMES.includes(name.trim().toLowerCase())) {
      return res.status(400).json({ error: name.trim() + ' is a reserved system role name.' });
    }
    if (base_role && !['manager','cashier','hr','accountant'].includes(base_role)) {
      return res.status(400).json({ error: 'Invalid base_role.' });
    }
    const permsJson = permissions
      ? (typeof permissions === 'object' ? JSON.stringify(permissions) : permissions)
      : existing[0].permissions;

    exec(db,
      'UPDATE custom_roles SET name=?, description=?, base_role=?, permissions=? WHERE id=?',
      [
        (name || existing[0].name).trim(),
        description !== undefined ? description : existing[0].description,
        base_role || existing[0].base_role,
        permsJson,
        req.params.id
      ]
    );

    logAudit(req, {
      action: 'ROLE_UPDATED',
      entity_type: 'role',
      entity_id: req.params.id,
      old_value: { name: existing[0].name, base_role: existing[0].base_role, permissions: existing[0].permissions },
      new_value: { name: (name || existing[0].name).trim(), base_role: base_role || existing[0].base_role, permissions: permsJson },
      details: `Custom role "${existing[0].name}" updated`
    });

    res.json({ success: true, message: 'Role updated.' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A role with that name already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
}

async function deleteRole(req, res) {
  try {
    const db = await getDb();
    const existing = query(db, 'SELECT * FROM custom_roles WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Role not found.' });
    if (existing[0].is_system) return res.status(403).json({ error: 'System roles cannot be deleted.' });

    exec(db, 'UPDATE users SET role = \'cashier\' WHERE LOWER(role) = LOWER(?)', [existing[0].name]);
    exec(db, 'DELETE FROM custom_roles WHERE id = ?', [req.params.id]);

    logAudit(req, {
      action: 'ROLE_DELETED',
      entity_type: 'role',
      entity_id: req.params.id,
      old_value: { name: existing[0].name, base_role: existing[0].base_role },
      details: `Custom role "${existing[0].name}" deleted. Affected users reset to cashier.`
    });

    res.json({ success: true, message: 'Role deleted. Affected users have been reset to Cashier.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = { getRoles, createRole, updateRole, deleteRole };