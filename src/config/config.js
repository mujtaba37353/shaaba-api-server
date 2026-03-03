require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  wc: {
    baseUrl: process.env.WC_BASE_URL || 'http://sshaabaa.local',
    consumerKey: process.env.WC_CONSUMER_KEY,
    consumerSecret: process.env.WC_CONSUMER_SECRET,
  },

  wp: {
    adminUser: process.env.WP_ADMIN_USER || '',
    appPassword: process.env.WP_APP_PASSWORD || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  },

  webhook: {
    secret: process.env.WEBHOOK_SECRET || '',
  },

  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS || '*',
  },

  pollInterval: parseInt(process.env.POLL_INTERVAL, 10) || 60000,
};
