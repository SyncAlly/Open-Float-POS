/** MODULE 7: Procurement Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/procurementController');

// GET  /api/procurement/suppliers         — active suppliers list
router.get('/suppliers', requireAuth, ctrl.getSuppliers);

// GET  /api/procurement/requests          — list purchase requests
router.get('/requests', requireAuth, ctrl.getPurchaseRequests);

// POST /api/procurement/requests          — submit new purchase request
router.post('/requests', requireAuth, ctrl.createPurchaseRequest);

// PATCH /api/procurement/requests/:id/status — approve/reject/deliver PR
router.patch('/requests/:id/status', requireAuth, ctrl.updatePRStatus);

module.exports = router;
