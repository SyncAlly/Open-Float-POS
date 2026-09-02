const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/zReportsController');

const managerUp = requireRole('owner', 'manager');

router.get('/', requireAuth, managerUp, ctrl.getZReports);
router.post('/generate', requireAuth, managerUp, ctrl.generateZReport);

module.exports = router;
