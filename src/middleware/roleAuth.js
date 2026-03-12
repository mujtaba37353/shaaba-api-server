const wc = require('../utils/woocommerce');
const { ROLES } = require('./auth');

const WP_ROLE_MAP = {
  administrator: ROLES.GENERAL_MANAGER,
  general_manager: ROLES.GENERAL_MANAGER,
  store_admin: ROLES.STORE_ADMIN,
  branch_manager: ROLES.BRANCH_MANAGER,
  branch_user: ROLES.BRANCH_USER,
  delivery_user: ROLES.DELIVERY_USER,
};

async function fetchUserRole(wpUser) {
  const metaData = wpUser.meta_data || [];

  const getMeta = (key) => {
    const entry = metaData.find((m) => m.key === key);
    return entry ? entry.value : null;
  };

  const wpRoles = wpUser.role ? [wpUser.role] : [];
  if (wpUser.roles) {
    wpRoles.push(...wpUser.roles);
  }

  let mappedRole = null;
  for (const r of wpRoles) {
    if (WP_ROLE_MAP[r]) {
      mappedRole = WP_ROLE_MAP[r];
      break;
    }
  }

  if (!mappedRole) {
    throw new Error('User does not have a valid app role');
  }

  const assignedCity = getMeta('_shaaba_assigned_city');
  const assignedBranch = getMeta('_shaaba_assigned_branch');

  return {
    role: mappedRole,
    assigned_city: assignedCity ? parseInt(assignedCity, 10) : null,
    assigned_branch: assignedBranch ? parseInt(assignedBranch, 10) : null,
  };
}

const STATUS_TRANSITIONS = {
  [ROLES.DELIVERY_USER]: {
    processing: ['sh-received', 'cancelled'],
    'sh-received': ['completed', 'cancelled'],
  },
  // branch_manager and branch_user are view-only (no status transitions)
};

function canTransitionStatus(role, currentStatus, newStatus) {
  if (role === ROLES.GENERAL_MANAGER || role === ROLES.STORE_ADMIN) {
    return true;
  }

  const allowed = STATUS_TRANSITIONS[role];
  if (!allowed || !allowed[currentStatus]) {
    return false;
  }

  return allowed[currentStatus].includes(newStatus);
}

module.exports = { fetchUserRole, canTransitionStatus, WP_ROLE_MAP };
