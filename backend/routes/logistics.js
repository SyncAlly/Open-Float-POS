/** MODULE 9: Logistics Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/logisticsController');

// GET   /api/logistics/deliveries         — List active/historical deliveries
router.get('/deliveries', requireAuth, ctrl.getDeliveries);

// POST  /api/logistics/deliveries         — Dispatch new delivery order
router.post('/deliveries', requireAuth, ctrl.createDelivery);

// PATCH /api/logistics/deliveries/:id/status — Update status/driver/ETA
router.patch('/deliveries/:id/status', requireAuth, ctrl.updateDeliveryStatus);

// DELETE /api/logistics/deliveries/:id — Delete delivery record
router.delete('/deliveries/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteDelivery);

module.exports = router;
