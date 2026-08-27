const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/hirePurchaseController');

router.get('/', requireAuth, ctrl.getAgreements);
router.post('/', requireAuth, ctrl.createAgreement);
router.post('/payment', requireAuth, ctrl.recordPayment);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteAgreement);

module.exports = router;
