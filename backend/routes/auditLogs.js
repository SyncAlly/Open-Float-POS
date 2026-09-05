/**
 * OpenFloat POS X — Centralized Security Audit Log Routes
 */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { getAuditLogs } = require('../utils/auditLogger');

// GET /api/audit-logs — Retrieve filtered, paginated audit records (owner, manager, auditor)
router.get('/', requireAuth, requireRole('owner', 'manager', 'auditor'), getAuditLogs);

module.exports = router;
