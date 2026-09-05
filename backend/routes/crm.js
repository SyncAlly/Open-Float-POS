/** MODULE 5: CRM Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/crmController');

// GET /api/crm/summary          — loyalty & customer summary
router.get('/summary', requireAuth, ctrl.getCRMSummary);

// POST /api/crm/customers/:id/redeem — redeem loyalty points
router.post('/customers/:id/redeem', requireAuth, ctrl.redeemPoints);

// GET /api/crm/customers?segment=&search=
router.get('/customers', requireAuth, ctrl.getCustomers);

// GET /api/crm/customers/:id
router.get('/customers/:id', requireAuth, ctrl.getCustomer);

// POST /api/crm/customers
router.post('/customers', requireAuth, validate(schemas.createCustomer), ctrl.createCustomer);

// PUT /api/crm/customers/:id
router.put('/customers/:id', requireAuth, validate(schemas.updateCustomer), ctrl.updateCustomer);

// DELETE /api/crm/customers/:id
router.delete('/customers/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteCustomer);

module.exports = router;
