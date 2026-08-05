/** MODULE 4: HR Routes — with RBAC */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const ctrl = require('../controllers/hrController');

const hrUp      = requireRole('owner', 'manager', 'hr');
const managerUp = requireRole('owner', 'manager');

// GET /api/hr/payroll/summary   — payroll summary (hr/manager/owner)
router.get('/payroll/summary', requireAuth, hrUp, ctrl.getPayrollSummary);

// POST /api/hr/attendance       — mark attendance (hr/manager/owner)
router.post('/attendance', requireAuth, hrUp, ctrl.markAttendance);

// GET /api/hr/employees         — list employees (hr/manager/owner)
router.get('/employees', requireAuth, hrUp, ctrl.getEmployees);

// GET /api/hr/employees/:id     — single employee (hr/manager/owner)
router.get('/employees/:id', requireAuth, hrUp, ctrl.getEmployee);

// POST /api/hr/employees        — create employee (manager/owner only)
router.post('/employees', requireAuth, managerUp, ctrl.createEmployee);

// PUT /api/hr/employees/:id     — update employee (manager/owner only)
router.put('/employees/:id', requireAuth, managerUp, ctrl.updateEmployee);

// DELETE /api/hr/employees/:id  — terminate employee (owner only)
router.delete('/employees/:id', requireAuth, requireRole('owner'), ctrl.deleteEmployee);

module.exports = router;
