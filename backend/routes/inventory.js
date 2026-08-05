/** MODULE 2: Inventory Routes — with RBAC */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/inventoryController');

const managerUp = requireRole('owner', 'manager');

// GET /api/inventory/summary         — stock health summary (all staff)
router.get('/summary', requireAuth, ctrl.getStockSummary);

// GET /api/inventory/categories      — list all categories (all staff)
router.get('/categories', requireAuth, ctrl.getCategories);

// GET /api/inventory                 — list products (all staff)
router.get('/', requireAuth, ctrl.getProducts);

// GET /api/inventory/:id             — single product (all staff)
router.get('/:id', requireAuth, ctrl.getProduct);

// POST /api/inventory                — create product (manager/owner only)
router.post('/', requireAuth, managerUp, ctrl.createProduct);

// PUT /api/inventory/:id             — update product (manager/owner only)
router.put('/:id', requireAuth, managerUp, ctrl.updateProduct);

// PATCH /api/inventory/:id/stock     — adjust stock (manager/owner only)
router.patch('/:id/stock', requireAuth, managerUp, ctrl.adjustStock);

// DELETE /api/inventory/:id          — delete product (owner only)
router.delete('/:id', requireAuth, requireRole('owner'), ctrl.deleteProduct);

module.exports = router;
