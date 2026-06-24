import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.XIAOXIAI_DB_PATH || path.join(__dirname, 'database.sqlite');
const logger = createLogger('db');
let resolveDbReady;
let rejectDbReady;
export const dbReady = new Promise((resolve, reject) => {
  resolveDbReady = resolve;
  rejectDbReady = reject;
});

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('Error opening SQLite database', { dbPath, error: err });
    rejectDbReady(err);
  } else {
    logger.info('Connected to SQLite database', { dbPath });
    initializeTables();
  }
});

// Wrap callback-based sqlite3 methods in Promises for async/await
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this); // 'this' contains changes and lastID
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Idempotently add a column; ignores the "already exists" error so the
// migration is safe to run on every startup.
async function addColumnIfMissing(table, columnDef) {
  try {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    logger.info('Migration applied: column added', { table, columnDef });
  } catch (alterError) {
    const message = alterError.message || '';
    if (!message.includes('duplicate column name') && !message.includes('already exists')) {
      logger.warn('Migration warning while adding column', { table, columnDef, error: message });
    }
  }
}

// Ensure idx_accounts_user is a UNIQUE index, upgrading an older non-unique
// index in place. SQLite's CREATE ... IF NOT EXISTS only checks the name, so an
// existing non-unique index must be dropped and recreated. Duplicate user_id
// rows are de-duplicated first (keeping the earliest) so the unique build can't
// fail on legacy data.
async function ensureUniqueAccountUserIndex() {
  const existing = await dbGet(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_accounts_user'"
  );
  if (existing && existing.sql && !/unique/i.test(existing.sql)) {
    await dbRun(
      'DELETE FROM accounts WHERE rowid NOT IN (SELECT MIN(rowid) FROM accounts GROUP BY user_id)'
    );
    await dbRun('DROP INDEX idx_accounts_user');
    logger.info('Migration: upgrading idx_accounts_user to a UNIQUE index');
  }
  await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)');
}

async function runColumnMigrations() {
  await addColumnIfMissing('users', 'summary TEXT DEFAULT ""');
  await addColumnIfMissing('users', 'last_task_reset TEXT');
  await addColumnIfMissing('users', 'checkin_streak INTEGER DEFAULT 0');
  await addColumnIfMissing('users', 'login_streak INTEGER DEFAULT 0');
  await addColumnIfMissing('users', 'last_login_date TEXT');
  await addColumnIfMissing('tasks', "category TEXT DEFAULT 'daily'");
  await addColumnIfMissing('user_memories', 'weight INTEGER DEFAULT 1');
  // Server-side token revocation: bumping an account's token_version invalidates
  // every token minted at an older version (logout-everywhere / refresh rotation).
  await addColumnIfMissing('accounts', 'token_version INTEGER DEFAULT 0');
}

// Create tables if they do not exist
async function initializeTables() {
  try {
    // Reliability PRAGMAs (set once on the single connection, before any DDL):
    // - WAL lets readers and a writer proceed concurrently instead of blocking.
    // - busy_timeout makes a contended write wait-and-retry instead of throwing
    //   SQLITE_BUSY (which previously surfaced as 500s, e.g. when the background
    //   memory-reflection write collided with a request write).
    await dbRun('PRAGMA journal_mode = WAL');
    await dbRun('PRAGMA busy_timeout = 5000');

    // 1. Users Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        level INTEGER DEFAULT 1,
        affection INTEGER DEFAULT 10,
        energy INTEGER DEFAULT 80,
        mood INTEGER DEFAULT 70,
        coins INTEGER DEFAULT 200,
        last_checkin TEXT,
        last_task_reset TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Chat Messages Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        sender TEXT CHECK(sender IN ('user', 'ai', 'system')),
        text TEXT,
        avatar_state TEXT DEFAULT 'normal',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 3. Daily Tasks Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tasks (
        user_id TEXT,
        task_id TEXT,
        name TEXT,
        reward INTEGER,
        progress INTEGER DEFAULT 0,
        target INTEGER,
        completed INTEGER DEFAULT 0,
        claimed INTEGER DEFAULT 0,
        PRIMARY KEY(user_id, task_id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 4. User Memories Table (Semantic Memory)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS user_memories (
        user_id TEXT,
        memory_key TEXT,
        memory_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, memory_key),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 5. Relationship Memory Timeline Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS relationship_memory_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        category TEXT,
        category_label TEXT,
        source_type TEXT,
        source_label TEXT,
        confidence TEXT,
        confidence_label TEXT,
        text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 6. Transactions Table (Coin Ledger / Wallet History)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT CHECK(type IN ('earn', 'spend')),
        category TEXT,
        amount INTEGER,
        balance INTEGER,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
    await dbRun(
      'CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at)'
    );

    // 7. Orders Table (real payment closed loop: create -> pay -> settle/refund)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        out_trade_no TEXT UNIQUE,
        tier_amount REAL,
        coins INTEGER,
        payment_method TEXT,
        status TEXT DEFAULT 'created' CHECK(status IN ('created', 'pending', 'paid', 'failed', 'refunded')),
        gateway_txn_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME,
        refunded_at DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');

    // 8. Analytics Events Table (behavior funnel + first-time milestones)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT,
        payload TEXT,
        day_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_events_day ON events(day_key)');

    // 9. Broadcasts Table (real site-wide ticker + operator announcements)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS broadcasts (
        id TEXT PRIMARY KEY,
        type TEXT DEFAULT 'system',
        text TEXT,
        priority INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(active, created_at)');

    // 10. Accounts Table (formal credential login bound to a guest user profile)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        identifier TEXT UNIQUE,
        identifier_type TEXT,
        password_hash TEXT,
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
    // UNIQUE so the database enforces "one guest profile -> at most one account"
    // even under concurrent register/bind requests (TOCTOU backstop).
    // NOTE: `CREATE UNIQUE INDEX IF NOT EXISTS` matches on index NAME only, so on
    // a DB that already has the OLD non-unique idx_accounts_user it would silently
    // no-op. Detect that case and upgrade the index (after de-duplicating).
    await ensureUniqueAccountUserIndex();

    // 11. Admin Audit Log (append-only trail of operator mutations)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id TEXT PRIMARY KEY,
        action TEXT,
        target_type TEXT,
        target_id TEXT,
        detail TEXT,
        ip TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at)');

    // 12. Config Overrides (operator-writable gameplay config: shop prices, tip
    // tier coins) so商品 values can change at runtime without a redeploy.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS config_overrides (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runColumnMigrations();

    const relationshipEventColumns = [
      { name: 'source_type', definition: 'TEXT DEFAULT "local_memory"' },
      { name: 'source_label', definition: 'TEXT DEFAULT "规则提取"' },
      { name: 'confidence', definition: 'TEXT DEFAULT "medium"' },
      { name: 'confidence_label', definition: 'TEXT DEFAULT "中可信"' },
    ];

    for (const column of relationshipEventColumns) {
      try {
        await dbRun(`ALTER TABLE relationship_memory_events ADD COLUMN ${column.name} ${column.definition}`);
        logger.info(`Migration applied: relationship_memory_events.${column.name} column added`);
      } catch (alterError) {
        if (!alterError.message.includes('duplicate column name') && !alterError.message.includes('already exists')) {
          logger.warn(`Migration warning for relationship_memory_events.${column.name} column`, { error: alterError.message });
        }
      }
    }

    logger.info('SQLite database tables initialized successfully');
    resolveDbReady();
  } catch (error) {
    logger.error('Error initializing SQLite tables', { error });
    rejectDbReady(error);
  }
}

export const closeDb = () => new Promise((resolve, reject) => {
  db.close((err) => {
    if (err) reject(err);
    else resolve();
  });
});

export default db;
