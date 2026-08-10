/** MODULE: M-Pesa Daraja API Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/mpesaController');

// POST /api/mpesa/stk-push          — Initiate STK Push prompt to customer
router.post('/stk-push', requireAuth, ctrl.initiateStkPush);

// POST /api/mpesa/callback           — Safaricom callback (NO auth — Safaricom calls this)
router.post('/callback', ctrl.handleCallback);

// GET  /api/mpesa/status/:checkout_request_id   — Poll payment status from DB
router.get('/status/:checkout_request_id', requireAuth, ctrl.queryPaymentStatus);

// GET  /api/mpesa/query/:checkout_request_id    — Query status from Safaricom directly
router.get('/query/:checkout_request_id', requireAuth, ctrl.querySTKStatus);

// GET  /api/mpesa/payments           — List all M-Pesa payment records
router.get('/payments', requireAuth, ctrl.listMpesaPayments);

module.exports = router;
