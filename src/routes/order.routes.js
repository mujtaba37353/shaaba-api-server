const router = require('express').Router();
const orderController = require('../controllers/order.controller');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');

const ASSIGN_DELIVERY_ROLES = [ROLES.GENERAL_MANAGER, ROLES.STORE_ADMIN, ROLES.BRANCH_MANAGER];

// GET / - list orders (authenticate + all roles)
router.get('/', authenticate, orderController.getOrders);

// GET /:id - single order (authenticate + all roles)
router.get('/:id', authenticate, orderController.getOrder);

// PUT /:id/status - update status (authenticate + all roles, controller validates transitions)
router.put('/:id/status', authenticate, orderController.updateOrderStatus);

// POST /:id/claim - delivery user claims an unassigned order (first come first served)
router.post('/:id/claim', authenticate, requireRole([ROLES.DELIVERY_USER]), orderController.claimOrder);

// PUT /:id/assign-delivery - assign delivery user (authenticate + general_manager, store_admin, branch_manager)
router.put('/:id/assign-delivery', authenticate, requireRole(ASSIGN_DELIVERY_ROLES), orderController.assignDelivery);

module.exports = router;
