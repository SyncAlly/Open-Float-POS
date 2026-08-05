const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/hirePurchaseController');

router.get('/', requireAuth, ctrl.getAgreements);
router.post('/', requireAuth, ctrl.createAgreement);
router.post('/payment', requireAuth, ctrl.recordPayment);

module.exports = router;
