const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

// POST /verify-email - check if email exists (no auth required)
router.post('/verify-email', authController.verifyEmail);

// POST / - login (no auth required)
router.post('/', authController.login);

// GET /me - current user (requires authenticate)
router.get('/me', authenticate, authController.getMe);

module.exports = router;
