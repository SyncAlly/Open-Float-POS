const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/suppliersController');

router.get('/', requireAuth, ctrl.getSuppliers);
router.post('/', requireAuth, ctrl.createSupplier);
router.put('/:id', requireAuth, ctrl.updateSupplier);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteSupplier);

module.exports = router;
