/** MODULE 6: Sales Terminal Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/salesController');

// POST /api/sales/checkout          — Complete POS order & deduct inventory
router.post('/checkout', requireAuth, validate(schemas.checkout), ctrl.processCheckout);

// POST /api/sales/transactions/:id/void — Void transaction, restore inventory, & log audit trail
router.post('/transactions/:id/void', requireAuth, requireRole('owner', 'manager'), ctrl.voidTransaction);

// GET  /api/sales/transactions      — Recent sales history
router.get('/transactions', requireAuth, ctrl.getTransactions);

// GET  /api/sales/transactions/:id  — Transaction details with line items
router.get('/transactions/:id', requireAuth, ctrl.getTransactionDetail);

module.exports = router;
