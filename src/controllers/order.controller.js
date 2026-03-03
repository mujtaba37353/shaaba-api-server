const wc = require('../utils/woocommerce');
const { ROLES, SUPERVISOR_ROLES, BRANCH_ROLES } = require('../middleware/auth');
const { canTransitionStatus } = require('../middleware/roleAuth');

function extractOrderMeta(order) {
  const meta = order.meta_data || [];
  const get = (key) => {
    const entry = meta.find((m) => m.key === key);
    return entry ? entry.value : null;
  };
  return {
    city_id: get('_shaaba_order_city') ? parseInt(get('_shaaba_order_city'), 10) : null,
    branch_id: get('_shaaba_order_branch') ? parseInt(get('_shaaba_order_branch'), 10) : null,
    delivery_user_id: get('_shaaba_order_delivery_user')
      ? parseInt(get('_shaaba_order_delivery_user'), 10)
      : null,
  };
}

function transformOrder(order) {
  const extracted = extractOrderMeta(order);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customer: {
      name: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim(),
      phone: order.billing?.phone || null,
      email: order.billing?.email || null,
    },
    items: (order.line_items || []).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      total: item.total,
      sku: item.sku || null,
      product_id: item.product_id,
    })),
    city_id: extracted.city_id,
    branch_id: extracted.branch_id,
    delivery_user_id: extracted.delivery_user_id,
    payment_method: order.payment_method,
    payment_method_title: order.payment_method_title,
    total: order.total,
    currency: order.currency,
    date_created: order.date_created,
    billing: order.billing || null,
    shipping: order.shipping || null,
    meta: order.meta_data || [],
  };
}

function checkOrderAccess(user, orderMeta) {
  if (SUPERVISOR_ROLES.includes(user.role)) return true;
  if (BRANCH_ROLES.includes(user.role)) {
    return orderMeta.branch_id === user.assigned_branch;
  }
  if (user.role === ROLES.DELIVERY_USER) {
    return orderMeta.delivery_user_id === user.id;
  }
  return false;
}

async function getOrders(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const params = { page, per_page };

    if (req.query.status) params.status = req.query.status;
    if (req.query.search) params.search = req.query.search;
    if (req.query.date_from) params.after = req.query.date_from;
    if (req.query.date_to) params.before = req.query.date_to;

    const { role } = req.user;

    if (role === ROLES.DELIVERY_USER) {
      params.meta_key = '_shaaba_order_delivery_user';
      params.meta_value = String(req.user.id);
    } else if (BRANCH_ROLES.includes(role)) {
      params.meta_key = '_shaaba_order_branch';
      params.meta_value = String(req.user.assigned_branch);
    } else if (SUPERVISOR_ROLES.includes(role)) {
      if (req.query.city_id) {
        params.meta_key = '_shaaba_order_city';
        params.meta_value = String(req.query.city_id);
      } else if (req.query.branch_id) {
        params.meta_key = '_shaaba_order_branch';
        params.meta_value = String(req.query.branch_id);
      }
      if (req.query.delivery_user_id) {
        params.meta_key = '_shaaba_order_delivery_user';
        params.meta_value = String(req.query.delivery_user_id);
      }
    }

    const response = await wc.get('/orders', {
      params,
      transformResponse: undefined,
    });

    let orders, total, totalPages;

    if (Array.isArray(response)) {
      orders = response;
      total = orders.length;
      totalPages = 1;
    } else if (response && response.headers) {
      orders = response.data;
      total = parseInt(response.headers['x-wp-total'], 10) || 0;
      totalPages = parseInt(response.headers['x-wp-totalpages'], 10) || 0;
    } else {
      orders = Array.isArray(response) ? response : [];
      total = orders.length;
      totalPages = 1;
    }

    // Server-side filtering safety net (in case WC ignores meta_key params)
    if (role === ROLES.DELIVERY_USER) {
      orders = orders.filter((o) => {
        const m = extractOrderMeta(o);
        return m.delivery_user_id === req.user.id;
      });
    } else if (BRANCH_ROLES.includes(role) && req.user.assigned_branch) {
      orders = orders.filter((o) => {
        const m = extractOrderMeta(o);
        return m.branch_id === req.user.assigned_branch;
      });
    }

    return res.json({
      orders: orders.map(transformOrder),
      pagination: { page, per_page, total: orders.length, total_pages: totalPages },
    });
  } catch (error) {
    next(error);
  }
}

async function getOrder(req, res, next) {
  try {
    const { id } = req.params;
    const order = await wc.get(`/orders/${id}`);

    const orderMeta = extractOrderMeta(order);
    if (!checkOrderAccess(req.user, orderMeta)) {
      return res.status(403).json({
        code: 'forbidden',
        message: 'You do not have access to this order',
      });
    }

    let notes = [];
    try {
      notes = await wc.get(`/orders/${id}/notes`);
    } catch (_) {
      /* notes are optional */
    }

    const transformed = transformOrder(order);
    transformed.notes = (notes || []).map((n) => ({
      id: n.id,
      author: n.author,
      note: n.note,
      date_created: n.date_created,
      customer_note: n.customer_note,
    }));

    return res.json({ order: transformed });
  } catch (error) {
    next(error);
  }
}

async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status) {
      return res.status(400).json({
        code: 'missing_status',
        message: 'Status is required',
      });
    }

    const order = await wc.get(`/orders/${id}`);
    const orderMeta = extractOrderMeta(order);

    if (!checkOrderAccess(req.user, orderMeta)) {
      return res.status(403).json({
        code: 'forbidden',
        message: 'You do not have access to this order',
      });
    }

    if (!canTransitionStatus(req.user.role, order.status, status)) {
      return res.status(400).json({
        code: 'invalid_transition',
        message: `Cannot transition from '${order.status}' to '${status}' with role '${req.user.role}'`,
      });
    }

    const updateData = { status };
    const updated = await wc.put(`/orders/${id}`, updateData);

    if (note) {
      try {
        await wc.post(`/orders/${id}/notes`, {
          note: `[${req.user.name}] ${note}`,
          customer_note: false,
        });
      } catch (_) {
        /* note creation failure is non-critical */
      }
    }

    return res.json({ order: transformOrder(updated) });
  } catch (error) {
    next(error);
  }
}

async function assignDelivery(req, res, next) {
  try {
    const { id } = req.params;
    const { delivery_user_id, expected_current } = req.body;

    if (!delivery_user_id) {
      return res.status(400).json({
        code: 'missing_delivery_user',
        message: 'delivery_user_id is required',
      });
    }

    const order = await wc.get(`/orders/${id}`);
    const orderMeta = extractOrderMeta(order);

    const currentDelivery = orderMeta.delivery_user_id
      ? String(orderMeta.delivery_user_id)
      : null;
    const expectedStr = expected_current != null ? String(expected_current) : null;

    if (currentDelivery !== expectedStr) {
      return res.status(409).json({
        code: 'conflict',
        message: 'Order delivery assignment has changed since you last viewed it',
        current_delivery_user_id: orderMeta.delivery_user_id,
      });
    }

    let deliveryUser;
    try {
      deliveryUser = await wc.get(`/customers/${delivery_user_id}`);
    } catch (_) {
      return res.status(404).json({
        code: 'delivery_user_not_found',
        message: 'Delivery user not found',
      });
    }

    const deliveryMeta = deliveryUser.meta_data || [];
    const deliveryCity = deliveryMeta.find((m) => m.key === '_shaaba_assigned_city');
    const deliveryCityId = deliveryCity ? parseInt(deliveryCity.value, 10) : null;

    if (orderMeta.city_id && deliveryCityId && deliveryCityId !== orderMeta.city_id) {
      return res.status(400).json({
        code: 'city_mismatch',
        message: "Delivery user's assigned city does not match the order's city",
      });
    }

    const updatedMeta = order.meta_data.map((m) => {
      if (m.key === '_shaaba_order_delivery_user') {
        return { ...m, value: String(delivery_user_id) };
      }
      return m;
    });

    const hasDeliveryMeta = updatedMeta.some((m) => m.key === '_shaaba_order_delivery_user');
    if (!hasDeliveryMeta) {
      updatedMeta.push({ key: '_shaaba_order_delivery_user', value: String(delivery_user_id) });
    }

    await wc.put(`/orders/${id}`, { meta_data: updatedMeta });

    try {
      await wc.post(`/orders/${id}/notes`, {
        note: `Delivery assigned to user #${delivery_user_id} by ${req.user.name}`,
        customer_note: false,
      });
    } catch (_) {
      /* non-critical */
    }

    return res.json({
      success: true,
      order_id: parseInt(id, 10),
      delivery_user_id: parseInt(delivery_user_id, 10),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getOrders, getOrder, updateOrderStatus, assignDelivery };
