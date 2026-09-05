const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/suppliersController');

router.get('/', requireAuth, ctrl.getSuppliers);
router.post('/', requireAuth, requireRole('owner', 'manager'), validate(schemas.createSupplier), ctrl.createSupplier);
router.put('/:id', requireAuth, requireRole('owner', 'manager'), validate(schemas.updateSupplier), ctrl.updateSupplier);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteSupplier);

module.exports = router;
