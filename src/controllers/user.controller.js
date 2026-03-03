const wc = require('../utils/woocommerce');
const { fetchUserRole } = require('../middleware/roleAuth');

async function getUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const params = { page, per_page, orderby: 'id', order: 'desc' };

    if (req.query.role) params.role = req.query.role;
    if (req.query.search) params.search = req.query.search;

    const customers = await wc.get('/customers', { params });

    let users = (Array.isArray(customers) ? customers : []).map((c) => {
      const meta = c.meta_data || [];
      const getMeta = (key) => {
        const entry = meta.find((m) => m.key === key);
        return entry ? entry.value : null;
      };
      return {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        email: c.email,
        role: c.role || null,
        assigned_city: getMeta('_shaaba_assigned_city')
          ? parseInt(getMeta('_shaaba_assigned_city'), 10)
          : null,
        assigned_branch: getMeta('_shaaba_assigned_branch')
          ? parseInt(getMeta('_shaaba_assigned_branch'), 10)
          : null,
        date_created: c.date_created,
        avatar_url: c.avatar_url || null,
      };
    });

    if (req.query.city_id) {
      const cityId = parseInt(req.query.city_id, 10);
      users = users.filter((u) => u.assigned_city === cityId);
    }
    if (req.query.branch_id) {
      const branchId = parseInt(req.query.branch_id, 10);
      users = users.filter((u) => u.assigned_branch === branchId);
    }

    return res.json({
      users,
      pagination: { page, per_page, total: users.length },
    });
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const { email, password, first_name, last_name, name, role, assigned_city, assigned_branch } =
      req.body;

    if (!email || !password) {
      return res.status(400).json({
        code: 'missing_fields',
        message: 'Email and password are required',
      });
    }

    const firstName = first_name || (name ? name.split(' ')[0] : '');
    const lastName = last_name || (name ? name.split(' ').slice(1).join(' ') : '');

    const metaData = [];
    if (role) metaData.push({ key: 'role', value: role });
    if (assigned_city != null) {
      metaData.push({ key: '_shaaba_assigned_city', value: String(assigned_city) });
    }
    if (assigned_branch != null) {
      metaData.push({ key: '_shaaba_assigned_branch', value: String(assigned_branch) });
    }

    const customer = await wc.post('/customers', {
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      role: role || 'branch_user',
      meta_data: metaData,
    });

    const userRole = await fetchUserRole(customer);

    return res.status(201).json({
      user: {
        id: customer.id,
        name: `${customer.first_name} ${customer.last_name}`.trim(),
        email: customer.email,
        role: userRole.role,
        assigned_city: userRole.assigned_city,
        assigned_branch: userRole.assigned_branch,
        date_created: customer.date_created,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, role, assigned_city, assigned_branch } = req.body;

    const updateData = {};
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;

    const metaData = [];
    if (assigned_city !== undefined) {
      metaData.push({
        key: '_shaaba_assigned_city',
        value: assigned_city != null ? String(assigned_city) : '',
      });
    }
    if (assigned_branch !== undefined) {
      metaData.push({
        key: '_shaaba_assigned_branch',
        value: assigned_branch != null ? String(assigned_branch) : '',
      });
    }
    if (metaData.length > 0) updateData.meta_data = metaData;

    const customer = await wc.put(`/customers/${id}`, updateData);
    const userRole = await fetchUserRole(customer);

    return res.json({
      user: {
        id: customer.id,
        name: `${customer.first_name} ${customer.last_name}`.trim(),
        email: customer.email,
        role: userRole.role,
        assigned_city: userRole.assigned_city,
        assigned_branch: userRole.assigned_branch,
        date_created: customer.date_created,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;

    await wc.delete(`/customers/${id}`, { params: { force: true } });

    return res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = { getUsers, createUser, updateUser, deleteUser };
