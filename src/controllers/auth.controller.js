const wc = require('../utils/woocommerce');
const { getUserByEmail } = require('../utils/wpApi');
const { generateToken } = require('../utils/jwt');
const { fetchUserRole, WP_ROLE_MAP } = require('../middleware/roleAuth');

/** 
 * Find a user by email across WooCommerce customers and WordPress users.
 * Returns a normalised object that fetchUserRole can consume, or null.
 */
async function findUserByEmail(email) {
  const lowerEmail = email.toLowerCase();

  // 1. WooCommerce customers (role: all)
  try {
    const customers = await wc.get('/customers', {
      params: { email, per_page: 1, role: 'all' },
    });
    if (Array.isArray(customers) && customers.length > 0) {
      const match = customers.find(
        (c) => c.email && c.email.toLowerCase() === lowerEmail
      );
      if (match) return match;
    }
  } catch (_) { /* continue */ }

  // 2. WooCommerce customers (search fallback)
  try {
    const customers = await wc.get('/customers', {
      params: { search: email, per_page: 10 },
    });
    if (Array.isArray(customers) && customers.length > 0) {
      const match = customers.find(
        (c) => c.email && c.email.toLowerCase() === lowerEmail
      );
      if (match) return match;
    }
  } catch (_) { /* continue */ }

  // 3. WordPress Users API (covers admin / shop_manager / custom roles)
  try {
    const wpUser = await getUserByEmail(email);
    if (wpUser) {
      return {
        id: wpUser.id,
        email: wpUser.email,
        first_name: wpUser.first_name || wpUser.name || '',
        last_name: wpUser.last_name || '',
        role: Array.isArray(wpUser.roles) ? wpUser.roles[0] : wpUser.role,
        roles: wpUser.roles || [],
        meta_data: wpUser.meta_data || wpUser.meta || [],
      };
    }
  } catch (_) { /* continue */ }

  return null;
}

async function verifyEmail(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        code: 'missing_email',
        message: 'البريد الإلكتروني مطلوب',
      });
    }

    const user = await findUserByEmail(email.trim());
    if (!user) {
      return res.status(404).json({
        code: 'user_not_found',
        message: 'لا يوجد مستخدم بهذا البريد الإلكتروني',
      });
    }

    let roleInfo;
    try {
      roleInfo = await fetchUserRole(user);
    } catch (_) {
      return res.status(403).json({
        code: 'no_app_role',
        message: 'هذا الحساب ليس لديه صلاحية الدخول للتطبيق',
      });
    }

    return res.json({
      verified: true,
      user: {
        id: user.id,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || email,
        email: user.email,
        role: roleInfo.role,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        code: 'missing_email',
        message: 'البريد الإلكتروني مطلوب',
      });
    }

    const user = await findUserByEmail(email.trim());
    if (!user) {
      return res.status(404).json({
        code: 'user_not_found',
        message: 'لا يوجد مستخدم بهذا البريد الإلكتروني',
      });
    }

    let roleInfo;
    try {
      roleInfo = await fetchUserRole(user);
    } catch (_) {
      return res.status(403).json({
        code: 'no_app_role',
        message: 'هذا الحساب ليس لديه صلاحية الدخول للتطبيق',
      });
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || email,
      role: roleInfo.role,
      assigned_city: roleInfo.assigned_city,
      assigned_branch: roleInfo.assigned_branch,
    };

    const token = generateToken(tokenPayload);

    return res.json({
      token,
      user: {
        id: user.id,
        name: tokenPayload.name,
        email: user.email,
        role: roleInfo.role,
        assigned_city: roleInfo.assigned_city,
        assigned_branch: roleInfo.assigned_branch,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    return res.json({ user: req.user });
  } catch (error) {
    next(error);
  }
}

module.exports = { verifyEmail, login, getMe };
