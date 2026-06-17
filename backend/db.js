import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'database.sqlite');

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
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

    // Migration: Add summary column to users if it doesn't exist
    try {
      await dbRun('ALTER TABLE users ADD COLUMN summary TEXT DEFAULT ""');
      console.log('Migration: summary column added to users table.');
    } catch (alterError) {
      // Ignore error if column already exists (SQLITE_ERROR: duplicate column name: summary)
      if (!alterError.message.includes('duplicate column name') && !alterError.message.includes('already exists')) {
        console.warn('Migration warning (summary column):', alterError.message);
      }
    }

    console.log('SQLite database tables initialized successfully.');
  } catch (error) {
    console.error('Error initializing SQLite tables:', error);
  }
}

export default db;
