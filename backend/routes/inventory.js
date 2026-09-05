/** MODULE 2: Inventory Routes — with RBAC */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/inventoryController');

const managerUp = requireRole('owner', 'manager');

// GET /api/inventory/summary         — stock health summary (all staff)
router.get('/summary', requireAuth, ctrl.getStockSummary);

// GET /api/inventory/categories      — list all categories (all staff)
router.get('/categories', requireAuth, ctrl.getCategories);

// POST /api/inventory/categories     — create category (manager/owner only)
router.post('/categories', requireAuth, managerUp, ctrl.createCategory);

// GET /api/inventory                 — list products (all staff)
router.get('/', requireAuth, ctrl.getProducts);

// GET /api/inventory/:id             — single product (all staff)
router.get('/:id', requireAuth, ctrl.getProduct);

// POST /api/inventory                — create product (manager/owner only)
router.post('/', requireAuth, managerUp, validate(schemas.createProduct), ctrl.createProduct);

// PUT /api/inventory/:id             — update product (manager/owner only)
router.put('/:id', requireAuth, managerUp, validate(schemas.updateProduct), ctrl.updateProduct);

// PATCH /api/inventory/:id/stock     — adjust stock (manager/owner only)
router.patch('/:id/stock', requireAuth, managerUp, validate(schemas.stockAdjustment), ctrl.adjustStock);

// DELETE /api/inventory/:id          — delete single product (manager/owner)
router.delete('/:id', requireAuth, managerUp, ctrl.deleteProduct);

// POST /api/inventory/bulk-delete    — bulk delete products (manager/owner)
router.post('/bulk-delete', requireAuth, managerUp, ctrl.bulkDeleteProducts);

module.exports = router;
