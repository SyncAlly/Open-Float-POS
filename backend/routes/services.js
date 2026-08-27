const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/servicesController');

router.get('/', requireAuth, ctrl.getServices);
router.post('/', requireAuth, ctrl.createService);
router.put('/:id', requireAuth, ctrl.updateService);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteService);

module.exports = router;
