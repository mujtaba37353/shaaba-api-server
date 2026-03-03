const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./src/config/config');
const { initializeDatabase, monitor } = require('./src/utils/db');

const authRoutes = require('./src/routes/auth.routes');
const orderRoutes = require('./src/routes/order.routes');
const userRoutes = require('./src/routes/user.routes');
const branchRoutes = require('./src/routes/branch.routes');
const deliveryRoutes = require('./src/routes/delivery.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
const webhookRoutes = require('./src/routes/webhook.routes');
const notificationRoutes = require('./src/routes/notification.routes');

const { startOrderMonitor } = require('./src/controllers/webhook.controller');
const { startReceiptChecker, startRetryLoop } = require('./src/controllers/notification.controller');

const app = express();

// --- Middleware ---
app.use(helmet());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

const corsOptions = {
  origin: config.cors.allowedOrigins === '*' ? '*' : config.cors.allowedOrigins.split(','),
  credentials: true,
};
app.use(cors(corsOptions));

app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// --- Routes ---
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/cities', branchRoutes);
app.use('/api/v1/delivery', deliveryRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const code = err.code || 'server_error';

  if (config.nodeEnv !== 'production') {
    console.error(err);
  }

  res.status(status).json({ code, message });
});

// --- Start ---
async function start() {
  await initializeDatabase();
  monitor.fixStaleProcessing.run();

  app.listen(config.port, () => {
    console.log(`[Sshabaa API] Running on port ${config.port} (${config.nodeEnv})`);
    console.log(`[Sshabaa API] WooCommerce: ${config.wc.baseUrl}`);

    startOrderMonitor();
    startReceiptChecker();
    startRetryLoop();
  });
}

start().catch((err) => {
  console.error('[Sshabaa API] Failed to start:', err);
  process.exit(1);
});

module.exports = app;
