const crypto = require('crypto');
const wc = require('../utils/woocommerce');
const config = require('../config/config');
const { monitor } = require('../utils/db');
const { sendPushNotification } = require('./notification.controller');

function verifyWebhookSignature(payload, signature) {
  if (!config.webhook.secret) return true;
  const hash = crypto
    .createHmac('sha256', config.webhook.secret)
    .update(payload, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || ''));
}

async function handleWooCommerceWebhook(req, res, next) {
  try {
    const signature = req.headers['x-wc-webhook-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (config.webhook.secret) {
      let valid = false;
      try {
        valid = verifyWebhookSignature(rawBody, signature);
      } catch (_) {
        valid = false;
      }
      if (!valid) {
        return res.status(401).json({ code: 'invalid_signature', message: 'Invalid webhook signature' });
      }
    }

    res.status(200).json({ received: true });

    const order = req.body;
    if (!order || !order.id) return;

    setImmediate(() => processOrderChange(order).catch((err) => {
      console.error('[webhook] Error processing order change:', err.message);
    }));
  } catch (error) {
    next(error);
  }
}

const STATUS_LABELS = {
  processing: 'جديد',
  'sh-received': 'تم الاستلام',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  refunded: 'مسترجع',
};

async function getDeliveryIdsForCity(cityId) {
  if (!cityId) return [];

  try {
    const customers = await wc.get('/customers', {
      params: { role: 'all', per_page: 100 },
    });
    const drivers = (Array.isArray(customers) ? customers : []).filter((c) => {
      const meta = c.meta_data || [];
      const city = meta.find((m) => m.key === '_shaaba_assigned_city');
      return (
        city &&
        String(city.value) === String(cityId) &&
        c.role === 'delivery_user'
      );
    });
    return drivers.map((d) => d.id);
  } catch (_) {
    return [];
  }
}

async function processOrderChange(order) {
  const orderId = order.id;
  const currentStatus = order.status;

  const meta = order.meta_data || [];
  const getMeta = (key) => {
    const entry = meta.find((m) => m.key === key);
    return entry ? entry.value : null;
  };

  const deliveryUserId = getMeta('_shaaba_order_delivery_user');
  const cityId = getMeta('_shaaba_order_city');

  const existing = monitor.get.get({ order_id: orderId });

  const isNewOrder = !existing;
  const hasStatusChange = !existing || existing.order_status !== currentStatus;
  const hasDeliveryChange =
    !existing || String(existing.assigned_delivery_user || '') !== String(deliveryUserId || '');

  if (!hasStatusChange && !hasDeliveryChange) return;

  monitor.markProcessing.run({
    order_id: orderId,
    order_status: currentStatus,
    assigned_delivery_user: deliveryUserId ? parseInt(deliveryUserId, 10) : null,
  });

  const statusLabel = STATUS_LABELS[currentStatus] || currentStatus;
  const orderRef = `#${order.number || orderId}`;

  if (isNewOrder && currentStatus === 'processing') {
    // Notify all delivery drivers in the order's city
    const cityDrivers = await getDeliveryIdsForCity(cityId);
    if (cityDrivers.length > 0) {
      try {
        await sendPushNotification(cityDrivers, {
          order_id: orderId,
          order_number: order.number || String(orderId),
          status: currentStatus,
          type: 'new_order',
          title: `طلب جديد ${orderRef}`,
          body: `طلب جديد في منطقتك - المبلغ: ${order.total || '0'} ر.س`,
        }, { activeOnly: false });
      } catch (err) {
        console.error('[webhook] City drivers push failed:', err.message);
      }
    }
  }

  if (hasDeliveryChange && deliveryUserId) {
    try {
      await sendPushNotification([parseInt(deliveryUserId, 10)], {
        order_id: orderId,
        order_number: order.number || String(orderId),
        status: currentStatus,
        type: 'delivery_assigned',
        title: `تم تعيينك للطلب ${orderRef}`,
        body: `الحالة: ${statusLabel}`,
      }, { activeOnly: false });
    } catch (err) {
      console.error('[webhook] Delivery push failed:', err.message);
    }
  } else if (hasStatusChange && !isNewOrder && deliveryUserId) {
    try {
      await sendPushNotification([parseInt(deliveryUserId, 10)], {
        order_id: orderId,
        order_number: order.number || String(orderId),
        status: currentStatus,
        type: 'status_change',
        title: `تحديث الطلب ${orderRef}`,
        body: `الحالة: ${statusLabel}`,
      }, { activeOnly: false });
    } catch (err) {
      console.error('[webhook] Status push failed:', err.message);
    }
  }

  monitor.markNotified.run({ order_id: orderId });
}

let isPolling = false;
let pollTimeout = null;

async function pollOrders() {
  if (isPolling) return;
  isPolling = true;

  try {
    const activeStatuses = ['processing', 'sh-received'];
    const orders = await wc.get('/orders', {
      params: { status: activeStatuses.join(','), per_page: 100 },
    });

    const orderList = Array.isArray(orders) ? orders : [];

    for (const order of orderList) {
      try {
        await processOrderChange(order);
      } catch (err) {
        console.error(`[monitor] Error processing order #${order.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[monitor] Poll cycle failed:', err.message);
  } finally {
    isPolling = false;
  }
}

function startOrderMonitor() {
  console.log(`[monitor] Starting order monitor (interval: ${config.pollInterval}ms)`);

  monitor.fixStaleProcessing.run();

  const cycle = async () => {
    await pollOrders();
    pollTimeout = setTimeout(cycle, config.pollInterval);
  };

  cycle();

  return () => {
    if (pollTimeout) {
      clearTimeout(pollTimeout);
      pollTimeout = null;
    }
  };
}

module.exports = { handleWooCommerceWebhook, startOrderMonitor };
