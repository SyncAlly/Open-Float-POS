const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/uploadController');

router.post('/', requireAuth, requireRole('owner', 'manager'), ctrl.uploadBatch);

module.exports = router;
