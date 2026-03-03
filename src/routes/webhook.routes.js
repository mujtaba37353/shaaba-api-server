const router = require('express').Router();
const webhookController = require('../controllers/webhook.controller');

// POST /wc - WooCommerce webhook (no auth, uses webhook secret verification in controller)
router.post('/wc', webhookController.handleWooCommerceWebhook);

module.exports = router;
