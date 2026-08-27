const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/receivablesController');

router.get('/', requireAuth, ctrl.getReceivablesSummary);
router.post('/payment', requireAuth, ctrl.recordARPayment);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteReceivable);

module.exports = router;
