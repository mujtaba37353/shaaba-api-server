const { verifyToken } = require('../utils/jwt');
const { tokens } = require('../utils/db');

const ROLES = {
  GENERAL_MANAGER: 'general_manager',
  STORE_ADMIN: 'store_admin',
  BRANCH_MANAGER: 'branch_manager',
  BRANCH_USER: 'branch_user',
  DELIVERY_USER: 'delivery_user',
};

const ADMIN_ROLES = [ROLES.GENERAL_MANAGER, ROLES.STORE_ADMIN];
const SUPERVISOR_ROLES = [ROLES.GENERAL_MANAGER, ROLES.STORE_ADMIN];
const BRANCH_ROLES = [ROLES.BRANCH_MANAGER, ROLES.BRANCH_USER];
const ALL_ROLES = Object.values(ROLES);

function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ code: 'unauthorized', message: 'Authentication required' });
    }

    const token = header.split(' ')[1];
    const decoded = verifyToken(token);

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      assigned_city: decoded.assigned_city || null,
      assigned_branch: decoded.assigned_branch || null,
    };

    tokens.updateLastActive.run({ user_id: req.user.id });

    next();
  } catch (error) {
    return res.status(401).json({ code: 'invalid_token', message: 'Invalid or expired token' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        code: 'forbidden',
        message: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
}

function checkBranchAccess(req, res, next) {
  if (SUPERVISOR_ROLES.includes(req.user.role)) {
    return next();
  }

  const requestedBranch = parseInt(req.params.branchId || req.query.branch_id || req.body.branch_id, 10);
  if (requestedBranch && BRANCH_ROLES.includes(req.user.role)) {
    if (req.user.assigned_branch && req.user.assigned_branch !== requestedBranch) {
      return res.status(403).json({ code: 'forbidden', message: 'Access denied to this branch' });
    }
  }

  next();
}

function checkCityAccess(req, res, next) {
  if (SUPERVISOR_ROLES.includes(req.user.role)) {
    return next();
  }

  const requestedCity = parseInt(req.params.cityId || req.query.city_id || req.body.city_id, 10);
  if (requestedCity && req.user.role === ROLES.DELIVERY_USER) {
    if (req.user.assigned_city && req.user.assigned_city !== requestedCity) {
      return res.status(403).json({ code: 'forbidden', message: 'Access denied to this city' });
    }
  }

  next();
}

module.exports = {
  authenticate,
  requireRole,
  checkBranchAccess,
  checkCityAccess,
  ROLES,
  ADMIN_ROLES,
  SUPERVISOR_ROLES,
  BRANCH_ROLES,
  ALL_ROLES,
};
