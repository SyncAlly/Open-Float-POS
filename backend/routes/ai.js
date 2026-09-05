/**
 * OpenFloat POS X — AI Assistant Routes
 */

const express = require('express');
const router = express.Router();
const { chat, getInsights } = require('../controllers/aiController');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

// POST /api/ai/chat — Send a message to the AI assistant (auth required)
router.post('/chat', requireAuth, validate(schemas.aiChat), chat);

// GET /api/ai/insights — Fetch proactive AI business insights (auth required)
router.get('/insights', requireAuth, getInsights);

module.exports = router;
