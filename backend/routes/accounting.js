/** MODULE 8: Accounting Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/accountingController');

// GET  /api/accounting/overview      — Financial KPI summary
router.get('/overview', requireAuth, ctrl.getFinancialOverview);

// GET  /api/accounting/ledgers       — Accounts Receivable & Payable
router.get('/ledgers', requireAuth, ctrl.getARAPLedgers);

// GET  /api/accounting/entries       — List journal entries
router.get('/entries', requireAuth, ctrl.getJournalEntries);

// POST /api/accounting/entries       — Create manual journal entry
router.post('/entries', requireAuth, ctrl.createJournalEntry);

module.exports = router;
