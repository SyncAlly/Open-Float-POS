/** MODULE 3: Auth Routes */

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const ctrl = require('../controllers/authController');

// Rate limiter: max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

// POST /api/auth/login           — returns JWT (rate limited)
router.post('/login', loginLimiter, validate(schemas.login), ctrl.login);

// GET  /api/auth/me              — get current user profile
router.get('/me', requireAuth, ctrl.me);

// PUT  /api/auth/change-password
router.put('/change-password', requireAuth, validate(schemas.updatePassword), ctrl.changePassword);

// POST /api/auth/register        — owner/manager/hr
router.post('/register', requireAuth, validate(schemas.register), ctrl.register);

// POST /api/auth/upsert-user     — owner/manager/hr (create or update user account)
router.post('/upsert-user', requireAuth, ctrl.upsertUserAccount);

module.exports = router;
