const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/stockMovementsController');

router.get('/', requireAuth, ctrl.getMovements);
router.post('/', requireAuth, ctrl.createMovement);

module.exports = router;
