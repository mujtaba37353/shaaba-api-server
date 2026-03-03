const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sshabaa.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let _saveTimer = null;

function scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (db) {
      fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    }
  }, 200);
}

function flushSave() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (db) {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  }
}

process.on('exit', flushSave);
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    flushSave();
    process.exit(0);
  });
});

function translateParams(params) {
  if (!params || typeof params !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[`@${key}`] = value === undefined ? null : value;
  }
  return out;
}

function prepare(sql) {
  return {
    run(params) {
      db.run(sql, translateParams(params));
      scheduleSave();
      return { changes: db.getRowsModified() };
    },
    get(params) {
      const stmt = db.prepare(sql);
      const translated = translateParams(params);
      if (Object.keys(translated).length > 0) {
        stmt.bind(translated);
      }
      let row;
      if (stmt.step()) {
        row = stmt.getAsObject();
      }
      stmt.free();
      return row || undefined;
    },
    all(params) {
      const rows = [];
      const stmt = db.prepare(sql);
      const translated = translateParams(params);
      if (Object.keys(translated).length > 0) {
        stmt.bind(translated);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    },
  };
}

const tokenStmts = {};
const notifStmts = {};
const monitorStmts = {};

async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      expo_token TEXT NOT NULL,
      device_id TEXT,
      device_name TEXT,
      platform TEXT,
      is_active INTEGER DEFAULT 1,
      last_success_at TEXT,
      last_active_at TEXT,
      failure_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, expo_token)
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id INTEGER,
      type TEXT NOT NULL,
      title TEXT,
      body TEXT,
      expo_ticket_id TEXT,
      expo_receipt_status TEXT,
      expo_receipt_message TEXT,
      retry_count INTEGER DEFAULT 0,
      next_retry_at TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      receipt_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS order_monitor_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE,
      order_status TEXT NOT NULL,
      assigned_delivery_user INTEGER,
      notification_status TEXT DEFAULT 'notified',
      notified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_device_tokens_active ON device_tokens(is_active);
    CREATE INDEX IF NOT EXISTS idx_notification_log_order ON notification_log(order_id);
    CREATE INDEX IF NOT EXISTS idx_notification_log_retry ON notification_log(expo_receipt_status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_order_monitor_status ON order_monitor_state(notification_status);
  `);

  Object.assign(tokenStmts, {
    upsertToken: prepare(`
      INSERT INTO device_tokens (user_id, expo_token, device_id, device_name, platform, last_active_at)
      VALUES (@user_id, @expo_token, @device_id, @device_name, @platform, datetime('now'))
      ON CONFLICT(user_id, expo_token) DO UPDATE SET
        device_id = @device_id,
        device_name = @device_name,
        platform = @platform,
        is_active = 1,
        failure_count = 0,
        last_active_at = datetime('now'),
        updated_at = datetime('now')
    `),

    removeToken: prepare(`
      DELETE FROM device_tokens WHERE expo_token = @expo_token
    `),

    getActiveTokensForUser: prepare(`
      SELECT * FROM device_tokens WHERE user_id = @user_id AND is_active = 1
    `),

    getActiveTokensForUsers: prepare(`
      SELECT * FROM device_tokens WHERE user_id IN (SELECT value FROM json_each(@user_ids)) AND is_active = 1
    `),

    getActiveTokensForActiveUsers: prepare(`
      SELECT * FROM device_tokens
      WHERE user_id IN (SELECT value FROM json_each(@user_ids))
        AND is_active = 1
        AND last_active_at > datetime('now', @active_window)
    `),

    updateLastActive: prepare(`
      UPDATE device_tokens SET last_active_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = @user_id AND is_active = 1
    `),

    markTokenSuccess: prepare(`
      UPDATE device_tokens SET last_success_at = datetime('now'), failure_count = 0, updated_at = datetime('now')
      WHERE expo_token = @expo_token
    `),

    incrementTokenFailure: prepare(`
      UPDATE device_tokens SET failure_count = failure_count + 1, updated_at = datetime('now')
      WHERE expo_token = @expo_token
    `),

    disableFailedTokens: prepare(`
      UPDATE device_tokens SET is_active = 0, updated_at = datetime('now')
      WHERE failure_count >= 3 AND is_active = 1
    `),

    disableToken: prepare(`
      UPDATE device_tokens SET is_active = 0, updated_at = datetime('now')
      WHERE expo_token = @expo_token
    `),
  });

  Object.assign(notifStmts, {
    insert: prepare(`
      INSERT INTO notification_log (user_id, order_id, type, title, body, expo_ticket_id, expo_receipt_status)
      VALUES (@user_id, @order_id, @type, @title, @body, @expo_ticket_id, @expo_receipt_status)
    `),

    getPendingReceipts: prepare(`
      SELECT * FROM notification_log
      WHERE expo_receipt_status = 'pending' AND expo_ticket_id IS NOT NULL
      LIMIT 100
    `),

    getRetryable: prepare(`
      SELECT * FROM notification_log
      WHERE expo_receipt_status = 'retry'
        AND next_retry_at <= datetime('now')
        AND retry_count < 3
      LIMIT 50
    `),

    updateReceipt: prepare(`
      UPDATE notification_log
      SET expo_receipt_status = @status, expo_receipt_message = @message, receipt_checked_at = datetime('now')
      WHERE id = @id
    `),

    markForRetry: prepare(`
      UPDATE notification_log
      SET expo_receipt_status = 'retry', retry_count = retry_count + 1, next_retry_at = @next_retry_at
      WHERE id = @id
    `),

    markFailed: prepare(`
      UPDATE notification_log
      SET expo_receipt_status = 'error', expo_receipt_message = @message
      WHERE id = @id
    `),
  });

  Object.assign(monitorStmts, {
    get: prepare(`
      SELECT * FROM order_monitor_state WHERE order_id = @order_id
    `),

    upsert: prepare(`
      INSERT INTO order_monitor_state (order_id, order_status, assigned_delivery_user, notification_status, notified_at)
      VALUES (@order_id, @order_status, @assigned_delivery_user, @notification_status, datetime('now'))
      ON CONFLICT(order_id) DO UPDATE SET
        order_status = @order_status,
        assigned_delivery_user = @assigned_delivery_user,
        notification_status = @notification_status,
        notified_at = datetime('now'),
        updated_at = datetime('now')
    `),

    markProcessing: prepare(`
      INSERT INTO order_monitor_state (order_id, order_status, assigned_delivery_user, notification_status)
      VALUES (@order_id, @order_status, @assigned_delivery_user, 'processing')
      ON CONFLICT(order_id) DO UPDATE SET
        order_status = @order_status,
        assigned_delivery_user = @assigned_delivery_user,
        notification_status = 'processing',
        updated_at = datetime('now')
    `),

    markNotified: prepare(`
      UPDATE order_monitor_state
      SET notification_status = 'notified', notified_at = datetime('now'), updated_at = datetime('now')
      WHERE order_id = @order_id
    `),

    fixStaleProcessing: prepare(`
      UPDATE order_monitor_state
      SET notification_status = 'notified', updated_at = datetime('now')
      WHERE notification_status = 'processing'
    `),
  });

  flushSave();
}

module.exports = {
  initializeDatabase,
  tokens: tokenStmts,
  notifications: notifStmts,
  monitor: monitorStmts,
};
