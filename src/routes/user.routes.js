const router = require('express').Router();
const userController = require('../controllers/user.controller');
const { authenticate, requireRole, ADMIN_ROLES } = require('../middleware/auth');

// GET / - list users (authenticate + admin roles)
router.get('/', authenticate, requireRole(ADMIN_ROLES), userController.getUsers);

// POST / - create user (authenticate + admin roles)
router.post('/', authenticate, requireRole(ADMIN_ROLES), userController.createUser);

// PUT /:id - update user (authenticate + admin roles)
router.put('/:id', authenticate, requireRole(ADMIN_ROLES), userController.updateUser);

// DELETE /:id - delete user (authenticate + admin roles)
router.delete('/:id', authenticate, requireRole(ADMIN_ROLES), userController.deleteUser);

module.exports = router;
