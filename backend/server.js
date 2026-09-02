/**
 * OpenFloat POS X — Backend Express Server Engine
 * Mounts all modular API controllers and serves frontend static assets.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

const UPLOADS_DIR = path.resolve(__dirname, '../uploads/products');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false
}));

const defaultAllowedOrigins = [
  'http://localhost:5000',
  'http://localhost:3000',
  'http://127.0.0.1:5000',
  'http://localhost'
];
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...configuredOrigins, ...defaultAllowedOrigins])];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Restrict access to sensitive backend files, dotfiles, database files, and config files
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (
    reqPath.startsWith('/backend') ||
    reqPath.startsWith('/attachment') ||
    reqPath.startsWith('/.') ||
    reqPath === '/package.json' ||
    reqPath === '/package-lock.json' ||
    reqPath === '/agent_changelog.md' ||
    reqPath.endsWith('.sqlite') ||
    reqPath.endsWith('.sqlite3') ||
    reqPath.endsWith('.db') ||
    reqPath.endsWith('.env')
  ) {
    return res.status(403).json({ error: 'Access forbidden.' });
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { dotfiles: 'ignore' }));
app.use(express.static(path.join(__dirname, '../'), { dotfiles: 'ignore' }));

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

app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  const status = err.status || 500;
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}: ${err.message}`);
  res.status(status).json({
    error: isDev ? err.message : 'An internal server error occurred. Please try again.'
  });
});

if (require.main === module) {
  process.on('SIGINT', () => {
    console.log('\n[OpenFloat] Server stopped.');
    process.exit(0);
  });

  if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'openfloat_secret' || process.env.JWT_SECRET === 'YOUR_JWT_SECRET_HERE')) {
    console.error('[Security] JWT_SECRET is required in production. Set it in your environment before starting the server.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[OpenFloat POS X] Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
