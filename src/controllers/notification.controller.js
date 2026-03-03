const axios = require('axios');
const { tokens, notifications, db } = require('../utils/db');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

async function registerDevice(req, res, next) {
  try {
    const { expo_token, device_id, device_name, platform } = req.body;

    if (!expo_token) {
      return res.status(400).json({
        code: 'missing_token',
        message: 'expo_token is required',
      });
    }

    if (!/^ExponentPushToken\[.+\]$/.test(expo_token) && !/^ExpoPushToken\[.+\]$/.test(expo_token)) {
      return res.status(400).json({
        code: 'invalid_token',
        message: 'Invalid Expo push token format',
      });
    }

    tokens.upsertToken.run({
      user_id: req.user.id,
      expo_token,
      device_id: device_id || null,
      device_name: device_name || null,
      platform: platform || null,
    });

    return res.json({ success: true, message: 'Device registered successfully' });
  } catch (error) {
    next(error);
  }
}

async function unregisterDevice(req, res, next) {
  try {
    const { expo_token } = req.body;

    if (!expo_token) {
      return res.status(400).json({
        code: 'missing_token',
        message: 'expo_token is required',
      });
    }

    tokens.removeToken.run({ expo_token });

    return res.json({ success: true, message: 'Device unregistered successfully' });
  } catch (error) {
    next(error);
  }
}

async function sendPushNotification(userIds, data, options = {}) {
  const { activeOnly = true, activeWindow = '-10 minutes' } = options;

  if (!userIds || userIds.length === 0) return { sent: 0, failed: 0 };

  const userIdsJson = JSON.stringify(userIds);

  let deviceTokens;
  if (activeOnly && activeWindow) {
    deviceTokens = tokens.getActiveTokensForActiveUsers.all({
      user_ids: userIdsJson,
      active_window: activeWindow,
    });
  } else {
    deviceTokens = tokens.getActiveTokensForUsers.all({ user_ids: userIdsJson });
  }

  if (deviceTokens.length === 0) {
    if (!activeOnly) return { sent: 0, failed: 0 };
    deviceTokens = tokens.getActiveTokensForUsers.all({ user_ids: userIdsJson });
    if (deviceTokens.length === 0) return { sent: 0, failed: 0 };
  }

  const messages = deviceTokens.map((dt) => ({
    to: dt.expo_token,
    sound: 'default',
    title: data.title || 'Sshabaa',
    body: data.body || '',
    data: {
      order_id: data.order_id,
      order_number: data.order_number,
      status: data.status,
      type: data.type,
    },
  }));

  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    try {
      const response = await axios.post(EXPO_PUSH_URL, chunk, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const tickets = response.data?.data || [];

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const message = chunk[i];
        const deviceToken = deviceTokens.find((dt) => dt.expo_token === message.to);
        const userId = deviceToken ? deviceToken.user_id : null;

        if (ticket.status === 'ok') {
          sent++;
          if (deviceToken) {
            tokens.markTokenSuccess.run({ expo_token: message.to });
          }
          notifications.insert.run({
            user_id: userId,
            order_id: data.order_id || null,
            type: data.type || 'general',
            title: data.title || 'Sshabaa',
            body: data.body || '',
            expo_ticket_id: ticket.id || null,
            expo_receipt_status: ticket.id ? 'pending' : 'ok',
          });
        } else {
          failed++;
          if (deviceToken) {
            tokens.incrementTokenFailure.run({ expo_token: message.to });
          }
          const isTransient = ticket.details?.error === 'PUSH_TOO_MANY_EXPERIENCE_IDS' ||
            ticket.details?.error === 'PUSH_TOO_MANY_NOTIFICATIONS' ||
            ticket.details?.error === 'PUSH_TOO_MANY_RECEIPTS';

          notifications.insert.run({
            user_id: userId,
            order_id: data.order_id || null,
            type: data.type || 'general',
            title: data.title || 'Sshabaa',
            body: data.body || '',
            expo_ticket_id: null,
            expo_receipt_status: isTransient ? 'retry' : 'error',
          });

          if (ticket.details?.error === 'DeviceNotRegistered') {
            tokens.disableToken.run({ expo_token: message.to });
          }
        }
      }
    } catch (err) {
      console.error('[notification] Expo push failed:', err.message);
      failed += chunk.length;

      for (const message of chunk) {
        const deviceToken = deviceTokens.find((dt) => dt.expo_token === message.to);
        notifications.insert.run({
          user_id: deviceToken ? deviceToken.user_id : null,
          order_id: data.order_id || null,
          type: data.type || 'general',
          title: data.title || 'Sshabaa',
          body: data.body || '',
          expo_ticket_id: null,
          expo_receipt_status: 'retry',
        });
      }
    }
  }

  tokens.disableFailedTokens.run();

  return { sent, failed, total: messages.length };
}

let receiptCheckerInterval = null;

function startReceiptChecker() {
  console.log('[notification] Starting receipt checker (interval: 15 min)');

  const check = async () => {
    try {
      const pending = notifications.getPendingReceipts.all();
      if (pending.length === 0) return;

      const ticketIds = pending.map((p) => p.expo_ticket_id).filter(Boolean);
      if (ticketIds.length === 0) return;

      const response = await axios.post(EXPO_RECEIPTS_URL, { ids: ticketIds }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const receipts = response.data?.data || {};

      for (const entry of pending) {
        if (!entry.expo_ticket_id) continue;

        const receipt = receipts[entry.expo_ticket_id];
        if (!receipt) continue;

        if (receipt.status === 'ok') {
          notifications.updateReceipt.run({
            id: entry.id,
            status: 'delivered',
            message: null,
          });
        } else if (receipt.status === 'error') {
          const errorMessage = receipt.message || receipt.details?.error || 'Unknown error';

          if (receipt.details?.error === 'DeviceNotRegistered') {
            notifications.updateReceipt.run({
              id: entry.id,
              status: 'device_removed',
              message: errorMessage,
            });

            const relatedTokens = tokens.getActiveTokensForUser.all({ user_id: entry.user_id });
            for (const dt of relatedTokens) {
              tokens.disableToken.run({ expo_token: dt.expo_token });
            }
          } else if (receipt.details?.error === 'MessageTooBig' || receipt.details?.error === 'InvalidCredentials') {
            notifications.markFailed.run({ id: entry.id, message: errorMessage });
          } else {
            const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            notifications.markForRetry.run({ id: entry.id, next_retry_at: retryAt });
          }
        }
      }
    } catch (err) {
      console.error('[notification] Receipt check failed:', err.message);
    }
  };

  check();
  receiptCheckerInterval = setInterval(check, 15 * 60 * 1000);

  return () => {
    if (receiptCheckerInterval) {
      clearInterval(receiptCheckerInterval);
      receiptCheckerInterval = null;
    }
  };
}

let retryLoopInterval = null;

function startRetryLoop() {
  console.log('[notification] Starting retry loop (interval: 30s)');

  const retry = async () => {
    try {
      const retryable = notifications.getRetryable.all();
      if (retryable.length === 0) return;

      for (const entry of retryable) {
        if (!entry.user_id) continue;

        try {
          await sendPushNotification(
            [entry.user_id],
            {
              title: entry.title,
              body: entry.body,
              order_id: entry.order_id,
              type: entry.type,
            },
            { activeOnly: false }
          );

          notifications.updateReceipt.run({
            id: entry.id,
            status: 'retried',
            message: `Retried at ${new Date().toISOString()}`,
          });
        } catch (err) {
          if (entry.retry_count >= 2) {
            notifications.markFailed.run({
              id: entry.id,
              message: `Max retries exceeded: ${err.message}`,
            });
          } else {
            const nextRetry = new Date(Date.now() + 60 * 1000).toISOString();
            notifications.markForRetry.run({ id: entry.id, next_retry_at: nextRetry });
          }
        }
      }
    } catch (err) {
      console.error('[notification] Retry loop failed:', err.message);
    }
  };

  retry();
  retryLoopInterval = setInterval(retry, 30 * 1000);

  return () => {
    if (retryLoopInterval) {
      clearInterval(retryLoopInterval);
      retryLoopInterval = null;
    }
  };
}

module.exports = {
  registerDevice,
  unregisterDevice,
  sendPushNotification,
  startReceiptChecker,
  startRetryLoop,
};
