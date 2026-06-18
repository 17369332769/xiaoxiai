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

// Create tables if they do not exist
async function initializeTables() {
  try {
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

    // Migration: Add summary column to users if it doesn't exist
    try {
      await dbRun('ALTER TABLE users ADD COLUMN summary TEXT DEFAULT ""');
      logger.info('Migration applied: users.summary column added');
    } catch (alterError) {
      // Ignore error if column already exists (SQLITE_ERROR: duplicate column name: summary)
      if (!alterError.message.includes('duplicate column name') && !alterError.message.includes('already exists')) {
        logger.warn('Migration warning for users.summary column', { error: alterError.message });
      }
    }

    try {
      await dbRun('ALTER TABLE users ADD COLUMN last_task_reset TEXT');
      logger.info('Migration applied: users.last_task_reset column added');
    } catch (alterError) {
      if (!alterError.message.includes('duplicate column name') && !alterError.message.includes('already exists')) {
        logger.warn('Migration warning for users.last_task_reset column', { error: alterError.message });
      }
    }

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
