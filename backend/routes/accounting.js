/** MODULE 8: Accounting Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/accountingController');

const managerUp = requireRole('owner', 'manager');

// GET  /api/accounting/overview      — Financial KPI summary (owner/manager only)
router.get('/overview', requireAuth, managerUp, ctrl.getFinancialOverview);

// GET  /api/accounting/ledgers       — Accounts Receivable & Payable (owner/manager only)
router.get('/ledgers', requireAuth, managerUp, ctrl.getARAPLedgers);

// GET  /api/accounting/entries       — List journal entries (owner/manager only)
router.get('/entries', requireAuth, managerUp, ctrl.getJournalEntries);

// POST /api/accounting/entries       — Create manual journal entry (owner/manager only)
router.post('/entries', requireAuth, managerUp, ctrl.createJournalEntry);

module.exports = router;
