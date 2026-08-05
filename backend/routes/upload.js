const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/uploadController');

router.post('/', requireAuth, ctrl.uploadBatch);

module.exports = router;
