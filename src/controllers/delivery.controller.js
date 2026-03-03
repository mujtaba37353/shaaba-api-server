const wc = require('../utils/woocommerce');
const { tokens } = require('../utils/db');

const TERMINAL_STATUSES = ['completed', 'cancelled', 'refunded'];

async function getCityDeliveryWorkers(req, res, next) {
  try {
    const { cityId } = req.params;

    if (!cityId) {
      return res.status(400).json({
        code: 'missing_city_id',
        message: 'City ID is required',
      });
    }

    const customers = await wc.get('/customers', {
      params: { role: 'delivery_user', per_page: 100 },
    });

    const cityWorkers = (Array.isArray(customers) ? customers : []).filter((c) => {
      const meta = c.meta_data || [];
      const cityMeta = meta.find((m) => m.key === '_shaaba_assigned_city');
      return cityMeta && String(cityMeta.value) === String(cityId);
    });

    const activeStatuses = ['processing', 'sh-pickup', 'sh-progress', 'sh-ready', 'sh-otw'];
    const statusQuery = activeStatuses.join(',');

    const workers = await Promise.all(
      cityWorkers.map(async (worker) => {
        let activeOrderCount = 0;
        try {
          const orders = await wc.get('/orders', {
            params: {
              meta_key: '_shaaba_order_delivery_user',
              meta_value: String(worker.id),
              status: statusQuery,
              per_page: 1,
            },
          });
          activeOrderCount = Array.isArray(orders) ? orders.length : 0;
        } catch (_) {
          /* count failure non-critical */
        }

        let lastActiveAt = null;
        try {
          const deviceTokens = tokens.getActiveTokensForUser.all({ user_id: worker.id });
          if (deviceTokens.length > 0) {
            const latest = deviceTokens.reduce((a, b) =>
              (a.last_active_at || '') > (b.last_active_at || '') ? a : b
            );
            lastActiveAt = latest.last_active_at;
          }
        } catch (_) {
          /* sqlite error non-critical */
        }

        return {
          id: worker.id,
          name: `${worker.first_name} ${worker.last_name}`.trim(),
          email: worker.email,
          phone: worker.billing?.phone || null,
          assigned_city: parseInt(cityId, 10),
          active_orders: activeOrderCount,
          last_active_at: lastActiveAt,
          avatar_url: worker.avatar_url || null,
        };
      })
    );

    return res.json({ workers, total: workers.length });
  } catch (error) {
    next(error);
  }
}

async function assignCity(req, res, next) {
  try {
    const { userId } = req.params;
    const { city_id } = req.body;

    if (city_id == null) {
      return res.status(400).json({
        code: 'missing_city_id',
        message: 'city_id is required',
      });
    }

    const customer = await wc.get(`/customers/${userId}`);

    const activeStatuses = ['processing', 'sh-pickup', 'sh-progress', 'sh-ready', 'sh-otw'];
    let activeOrders = [];
    try {
      const orders = await wc.get('/orders', {
        params: {
          meta_key: '_shaaba_order_delivery_user',
          meta_value: String(userId),
          status: activeStatuses.join(','),
          per_page: 100,
        },
      });
      activeOrders = Array.isArray(orders) ? orders : [];
    } catch (_) {
      /* treat fetch error as no orders */
    }

    const nonTerminal = activeOrders.filter(
      (o) => !TERMINAL_STATUSES.includes(o.status)
    );

    if (nonTerminal.length > 0) {
      return res.status(403).json({
        code: 'active_orders_exist',
        message: `User has ${nonTerminal.length} active order(s). Complete or reassign them first.`,
        active_orders: nonTerminal.map((o) => ({
          id: o.id,
          number: o.number,
          status: o.status,
        })),
      });
    }

    const metaData = (customer.meta_data || []).map((m) => {
      if (m.key === '_shaaba_assigned_city') {
        return { ...m, value: String(city_id) };
      }
      return m;
    });

    const hasCityMeta = metaData.some((m) => m.key === '_shaaba_assigned_city');
    if (!hasCityMeta) {
      metaData.push({ key: '_shaaba_assigned_city', value: String(city_id) });
    }

    const updated = await wc.put(`/customers/${userId}`, { meta_data: metaData });

    return res.json({
      success: true,
      user_id: updated.id,
      assigned_city: parseInt(city_id, 10),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getCityDeliveryWorkers, assignCity };
