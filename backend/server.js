/**
 * OpenFloat POS X — Backend Express Server Engine
 * Mounts all modular API controllers and serves frontend static assets.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure upload media directory exists
const UPLOADS_DIR = path.resolve(__dirname, '../uploads/products');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Core Middleware
const allowedOrigins = [
  'http://localhost:5000',
  'http://localhost:3000',
  'http://127.0.0.1:5000',
  // Add your production domain here when deploying:
  // 'https://your-production-domain.com'
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Postman, mobile apps on same machine)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded product images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve frontend static files directly from root directory
app.use(express.static(path.join(__dirname, '../')));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  const hasGeminiKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE';
  res.json({
    status: 'online',
    app: 'OpenFloat POS X API Engine',
    version: '1.0.0',
    db: 'connected',
    ai_configured: hasGeminiKey,
    env_loaded: true,
    timestamp: new Date().toISOString()
  });
});

// API Routes (Simplest -> Most Complex)
app.use('/api/settings',        require('./routes/settings'));
app.use('/api/branches',        require('./routes/branches'));
app.use('/api/inventory',       require('./routes/inventory'));
app.use('/api/auth',            require('./routes/auth'));
app.use('/api/hr',              require('./routes/hr'));
app.use('/api/crm',             require('./routes/crm'));
app.use('/api/sales',           require('./routes/sales'));
app.use('/api/procurement',     require('./routes/procurement'));
app.use('/api/accounting',      require('./routes/accounting'));
app.use('/api/logistics',       require('./routes/logistics'));
app.use('/api/services',        require('./routes/services'));
app.use('/api/stock-movements', require('./routes/stockMovements'));
app.use('/api/hire-purchase',   require('./routes/hirePurchase'));
app.use('/api/z-reports',       require('./routes/zReports'));
app.use('/api/suppliers',       require('./routes/suppliers'));
app.use('/api/receivables',     require('./routes/receivables'));
app.use('/api/upload',          require('./routes/upload'));
app.use('/api/ai',              require('./routes/ai'));
app.use('/api/mpesa',           require('./routes/mpesa'));

// ─── Global Error Handler (Fix 7: hide internals in production) ────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  const status = err.status || 500;
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}: ${err.message}`);
  res.status(status).json({
    error: isDev ? err.message : 'An internal server error occurred. Please try again.'
  });
});

// Start Server
if (require.main === module) {
  // Graceful exit
  process.on('SIGINT', () => {
    console.log('\n[OpenFloat] Server stopped.');
    process.exit(0);
  });
  app.listen(PORT, () => {
    console.log(`[OpenFloat POS X] Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
