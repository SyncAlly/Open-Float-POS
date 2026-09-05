const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/hirePurchaseController');

router.get('/', requireAuth, ctrl.getAgreements);
router.post('/', requireAuth, validate(schemas.createHP), ctrl.createAgreement);
router.post('/payment', requireAuth, validate(schemas.recordHPPayment), ctrl.recordPayment);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteAgreement);

module.exports = router;
