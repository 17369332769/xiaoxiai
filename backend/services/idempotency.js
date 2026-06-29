import { dbRun } from '../core/db.js';

// Atomically claim a client-supplied idempotency key for a state-mutating action.
//
// Returns true the FIRST time this (user, action, requestId) is seen — the caller
// should proceed and apply the side effects. Returns false on any duplicate — the
// caller must short-circuit WITHOUT re-applying coins / affection / messages.
//
// The stored primary key is namespaced as `${userId}:${action}:${requestId}` so a
// requestId reused across different users or actions can never collide. SQLite
// serializes writes, so two concurrent duplicates reliably resolve to exactly one
// winner (changes === 1) and one loser (changes === 0).
export async function claimIdempotencyKey(userId, action, requestId) {
  const key = `${userId}:${action}:${requestId}`;
  const result = await dbRun(
    'INSERT OR IGNORE INTO idempotency_keys (key, user_id, action) VALUES (?, ?, ?)',
    [key, userId, action]
  );
  return result.changes === 1;
}
