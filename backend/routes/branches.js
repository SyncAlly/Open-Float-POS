/** MODULE: Branch Routes */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/branchController');

// GET  /api/branches       — List all store branches (all staff)
router.get('/', requireAuth, ctrl.getBranches);

// POST /api/branches       — Create new branch (owner/manager)
router.post('/', requireAuth, ctrl.createBranch);

// PUT  /api/branches/:id   — Edit branch (owner/manager)
router.put('/:id', requireAuth, ctrl.updateBranch);

// DELETE /api/branches/:id — Delete branch (owner only)
router.delete('/:id', requireAuth, ctrl.deleteBranch);

module.exports = router;
