const wc = require('../utils/woocommerce');
const { SUPERVISOR_ROLES, BRANCH_ROLES, ROLES } = require('../middleware/auth');

async function getSummary(req, res, next) {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const params = {
      after: todayStart.toISOString(),
      per_page: 100,
      page: 1,
    };

    const { role } = req.user;
    if (role === ROLES.DELIVERY_USER) {
      params.meta_key = '_shaaba_order_delivery_user';
      params.meta_value = String(req.user.id);
    } else if (BRANCH_ROLES.includes(role)) {
      params.meta_key = '_shaaba_order_branch';
      params.meta_value = String(req.user.assigned_branch);
    }

    let allOrders = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      params.page = page;
      const batch = await wc.get('/orders', { params });
      const orders = Array.isArray(batch) ? batch : [];
      allOrders = allOrders.concat(orders);
      hasMore = orders.length === 100;
      page++;
      if (page > 10) break;
    }

    const byStatus = {};
    const byCity = {};
    const byBranch = {};
    let totalRevenue = 0;

    for (const order of allOrders) {
      const status = order.status;
      byStatus[status] = (byStatus[status] || 0) + 1;
      totalRevenue += parseFloat(order.total) || 0;

      const meta = order.meta_data || [];
      const getMeta = (key) => {
        const entry = meta.find((m) => m.key === key);
        return entry ? entry.value : null;
      };

      const cityId = getMeta('_shaaba_order_city');
      if (cityId) {
        byCity[cityId] = (byCity[cityId] || 0) + 1;
      }

      const branchId = getMeta('_shaaba_order_branch');
      if (branchId) {
        byBranch[branchId] = (byBranch[branchId] || 0) + 1;
      }
    }

    return res.json({
      summary: {
        date: todayStart.toISOString().split('T')[0],
        total_orders: allOrders.length,
        total_revenue: totalRevenue.toFixed(2),
        by_status: byStatus,
        by_city: byCity,
        by_branch: byBranch,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSummary };
