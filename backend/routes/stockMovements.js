const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/stockMovementsController');

router.get('/', requireAuth, ctrl.getMovements);
router.post('/', requireAuth, requireRole('owner', 'manager'), ctrl.createMovement);
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteMovement);

module.exports = router;
