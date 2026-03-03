const router = require('express').Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate, requireRole, ADMIN_ROLES } = require('../middleware/auth');

// GET /summary - dashboard summary (authenticate + admin roles)
router.get('/summary', authenticate, requireRole(ADMIN_ROLES), dashboardController.getSummary);

module.exports = router;
