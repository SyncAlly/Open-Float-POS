/**
 * Branch Routes — /api/branches
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/branchController');

// GET /api/branches — All authenticated users can list active branches
router.get('/', requireAuth, ctrl.getBranches);

// GET /api/branches/performance — Owner-Exclusive branch comparative performance metrics
router.get('/performance', requireAuth, requireRole('owner'), ctrl.getBranchPerformance);

// POST /api/branches — Owner-Exclusive: create new branches
router.post('/', requireAuth, requireRole('owner'), validate(schemas.createBranch), ctrl.createBranch);

// PUT /api/branches/:id — Owner-Exclusive: update branches
router.put('/:id', requireAuth, requireRole('owner'), validate(schemas.updateBranch), ctrl.updateBranch);

// DELETE /api/branches/:id — Owner-Exclusive: deactivate branches
router.delete('/:id', requireAuth, requireRole('owner'), ctrl.deleteBranch);

module.exports = router;
