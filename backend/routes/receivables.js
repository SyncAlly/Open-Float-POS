const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/receivablesController');

router.get('/', requireAuth, ctrl.getReceivablesSummary);
router.post('/payment', requireAuth, ctrl.recordARPayment);

module.exports = router;
