const router = require('express').Router();
const branchController = require('../controllers/branch.controller');
const { authenticate } = require('../middleware/auth');

// GET / - branches or cities based on baseUrl (same router mounted at /branches and /cities)
router.get('/', authenticate, (req, res, next) => {
  if (req.baseUrl.endsWith('/cities')) {
    return branchController.getCities(req, res, next);
  }
  return branchController.getBranches(req, res, next);
});

// GET /:id - single branch (authenticate)
router.get('/:id', authenticate, branchController.getBranch);

module.exports = router;
