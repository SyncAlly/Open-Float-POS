/** MODULE 1: Settings Routes — with RBAC */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/settingsController');

// GET /api/settings        — all settings (all authenticated staff)
router.get('/', requireAuth, ctrl.getSettings);

// GET /api/settings/:key   — single setting (all authenticated staff)
router.get('/:key', requireAuth, ctrl.getSetting);

// PUT /api/settings        — update settings (owner only — M-Pesa keys, VAT, etc.)
router.put('/', requireAuth, requireRole('owner'), ctrl.updateSettings);

module.exports = router;
