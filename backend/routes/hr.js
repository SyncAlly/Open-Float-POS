/** MODULE 4: HR Routes — Clock-In/Out, Payroll, Labor Analytics */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/hrController');

const anyStaff  = requireRole('owner', 'manager', 'hr', 'cashier');
const managerUp = requireRole('owner', 'manager');

// Payroll
router.get('/payroll/summary',   requireAuth, anyStaff,  ctrl.getPayrollSummary);
router.get('/payroll/calculate', requireAuth, managerUp, ctrl.calculatePayroll);
router.get('/payroll/export',    requireAuth, managerUp, ctrl.exportPayroll);

// Clock In / Out (all authenticated staff)
router.post('/clock-in',    requireAuth, anyStaff, ctrl.clockIn);
router.post('/clock-out',   requireAuth, anyStaff, ctrl.clockOut);
router.get('/shift-status', requireAuth, anyStaff, ctrl.getShiftStatus);

// Labor Analytics
router.get('/labor-analytics', requireAuth, managerUp, ctrl.getLaborAnalytics);

// Employees
router.get('/employees',       requireAuth, anyStaff,  ctrl.getEmployees);
router.get('/employees/:id',   requireAuth, anyStaff,  ctrl.getEmployee);
router.post('/employees',      requireAuth, managerUp, validate(schemas.createEmployee), ctrl.createEmployee);
router.put('/employees/:id',   requireAuth, managerUp, validate(schemas.updateEmployee), ctrl.updateEmployee);
router.delete('/employees/:id',requireAuth, requireRole('owner'), ctrl.deleteEmployee);

module.exports = router;

