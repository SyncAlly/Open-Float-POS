const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/zReportsController');

router.get('/', requireAuth, ctrl.getZReports);
router.post('/generate', requireAuth, ctrl.generateZReport);

module.exports = router;
