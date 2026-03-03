const router = require('express').Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');

// POST /register-device - register device for push notifications (authenticate)
router.post('/register-device', authenticate, notificationController.registerDevice);

// DELETE /unregister-device - unregister device (authenticate)
router.delete('/unregister-device', authenticate, notificationController.unregisterDevice);

module.exports = router;
