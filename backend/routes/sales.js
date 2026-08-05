/** MODULE 6: Sales Terminal Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/salesController');

// POST /api/sales/checkout          — Complete POS order & deduct inventory
router.post('/checkout', requireAuth, ctrl.processCheckout);

// GET  /api/sales/transactions      — Recent sales history
router.get('/transactions', requireAuth, ctrl.getTransactions);

// GET  /api/sales/transactions/:id  — Transaction details with line items
router.get('/transactions/:id', requireAuth, ctrl.getTransactionDetail);

module.exports = router;
