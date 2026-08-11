/**
 * Branch Routes — /api/branches
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/branchController');

// GET /api/branches — All authenticated users can list active branches
router.get('/', requireAuth, ctrl.getBranches);

// POST /api/branches — Owner & Manager can create new branches
router.post('/', requireAuth, requireRole('owner', 'manager'), ctrl.createBranch);

// PUT /api/branches/:id — Owner & Manager can update branches
router.put('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.updateBranch);

// DELETE /api/branches/:id — Owner & Manager can deactivate branches
router.delete('/:id', requireAuth, requireRole('owner', 'manager'), ctrl.deleteBranch);

module.exports = router;
