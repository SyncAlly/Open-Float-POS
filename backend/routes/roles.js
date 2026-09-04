const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/rolesController');

router.get('/',     requireAuth,                        ctrl.getRoles);
router.post('/',    requireAuth, requireRole('owner'),  ctrl.createRole);
router.put('/:id',  requireAuth, requireRole('owner'),  ctrl.updateRole);
router.delete('/:id', requireAuth, requireRole('owner'), ctrl.deleteRole);

module.exports = router;
