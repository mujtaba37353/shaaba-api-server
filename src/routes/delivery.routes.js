const router = require('express').Router();
const deliveryController = require('../controllers/delivery.controller');
const { authenticate, requireRole, SUPERVISOR_ROLES, ROLES, ADMIN_ROLES } = require('../middleware/auth');

const CITY_DELIVERY_ROLES = [...SUPERVISOR_ROLES, ROLES.BRANCH_MANAGER];

// GET /city/:cityId - delivery by city (authenticate + supervisor + branch_manager)
router.get('/city/:cityId', authenticate, requireRole(CITY_DELIVERY_ROLES), deliveryController.getCityDeliveryWorkers);

// PUT /:userId/assign-city - assign city to user (authenticate + admin roles)
router.put('/:userId/assign-city', authenticate, requireRole(ADMIN_ROLES), deliveryController.assignCity);

module.exports = router;
