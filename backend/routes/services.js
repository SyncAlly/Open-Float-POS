const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/servicesController');

router.get('/', requireAuth, ctrl.getServices);
router.post('/', requireAuth, ctrl.createService);
router.put('/:id', requireAuth, ctrl.updateService);
router.delete('/:id', requireAuth, ctrl.deleteService);

module.exports = router;
