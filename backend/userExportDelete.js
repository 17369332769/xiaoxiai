import { dbAll, dbGet, dbRun } from './db.js';
import { recordAdminAudit } from './adminAudit.js';
import { createLogger } from './logger.js';

const logger = createLogger('user-data');

// Every user-scoped table, child-before-parent for safe sequential deletion.
// `users` (the parent) is deleted last; `accounts` is keyed by user_id too.
const USER_CHILD_TABLES = [
  { table: 'chat_messages', column: 'user_id' },
  { table: 'tasks', column: 'user_id' },
  { table: 'user_memories', column: 'user_id' },
  { table: 'relationship_memory_events', column: 'user_id' },
  { table: 'transactions', column: 'user_id' },
  { table: 'orders', column: 'user_id' },
  { table: 'events', column: 'user_id' },
  { table: 'accounts', column: 'user_id' },
];

// Assemble every piece of data we hold for a user (GDPR-style portability).
// The account's password hash is deliberately omitted — it is a secret, not the
// user's own data to take with them.
export async function exportUserData(userId) {
  const [user, chatMessages, tasks, memories, relationshipEvents, transactions, orders, events, account] =
    await Promise.all([
      dbGet('SELECT * FROM users WHERE id = ?', [userId]),
      dbAll('SELECT id, sender, text, avatar_state, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at', [userId]),
      dbAll('SELECT task_id, name, reward, progress, target, completed, claimed, category FROM tasks WHERE user_id = ?', [userId]),
      dbAll('SELECT memory_key, memory_value, weight, updated_at FROM user_memories WHERE user_id = ? ORDER BY updated_at', [userId]),
      dbAll('SELECT * FROM relationship_memory_events WHERE user_id = ? ORDER BY created_at', [userId]),
      dbAll('SELECT id, type, category, amount, balance, description, created_at FROM transactions WHERE user_id = ? ORDER BY created_at', [userId]),
      dbAll('SELECT id, out_trade_no, tier_amount, coins, payment_method, status, gateway_txn_id, created_at, paid_at, refunded_at FROM orders WHERE user_id = ? ORDER BY created_at', [userId]),
      dbAll('SELECT id, type, payload, day_key, created_at FROM events WHERE user_id = ? ORDER BY created_at', [userId]),
      dbGet('SELECT identifier, identifier_type, created_at FROM accounts WHERE user_id = ?', [userId]),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    user: user || null,
    account: account || null,
    chatMessages,
    memories,
    tasks,
    relationshipEvents,
    transactions,
    orders,
    events,
  };
}

// Irreversibly delete a user and everything keyed to them. Sequential deletes
// (child tables first, users last) WITHOUT a wrapping transaction — the project
// deliberately avoids explicit transactions on the shared sqlite connection
// (see ledger A4), and each DELETE is individually atomic. Returns per-table
// removed-row counts. Best-effort audit trail for compliance.
export async function deleteUserAccount(userId) {
  const removed = {};
  for (const { table, column } of USER_CHILD_TABLES) {
    try {
      const result = await dbRun(`DELETE FROM ${table} WHERE ${column} = ?`, [userId]);
      removed[table] = result.changes;
    } catch (error) {
      logger.error('Failed to delete user rows', { table, userId, error: error.message });
      removed[table] = -1;
    }
  }
  const userResult = await dbRun('DELETE FROM users WHERE id = ?', [userId]);
  removed.users = userResult.changes;

  await recordAdminAudit('user_self_delete', { targetType: 'user', targetId: userId, detail: removed });
  return removed;
}
