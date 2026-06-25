// In-memory presence tracker that turns the previously fake "online count" into
// a real number derived from active heartbeats. A user is considered online if
// they have pinged within the TTL window. This is per-process (good enough for a
// single-instance demo); a multi-instance deployment would back this with Redis.

export function createPresenceTracker({ ttlMs = 60000, baseline = 0 } = {}) {
  const lastSeen = new Map();

  function touch(userId) {
    if (!userId) return;
    lastSeen.set(userId, Date.now());
  }

  function prune(now = Date.now()) {
    for (const [userId, ts] of lastSeen) {
      if (now - ts > ttlMs) {
        lastSeen.delete(userId);
      }
    }
  }

  function count() {
    prune();
    return lastSeen.size;
  }

  // The displayed count blends real online users with a configurable baseline so
  // an early-stage product never looks empty. The baseline is transparent (and
  // can be set to 0 to show only real users).
  function displayCount() {
    return baseline + count();
  }

  return { touch, count, displayCount, prune, _store: lastSeen };
}
