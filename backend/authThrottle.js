// Login brute-force throttle. The global per-IP rate limiter is coarse and shared
// across all routes; this adds a focused failed-attempt lockout keyed by
// identifier+IP so credential stuffing against a single account is expensive,
// without penalizing unrelated traffic. In-memory (single-instance) — mirrors the
// existing rate limiter; a multi-instance deployment would back this with a shared
// store (e.g. Redis).
const DEFAULT_MAX_FAILED = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // failures counted within this window
const DEFAULT_LOCK_MS = 60 * 1000; // lockout duration once the threshold is hit

export function createLoginThrottle({
  maxFailed = DEFAULT_MAX_FAILED,
  windowMs = DEFAULT_WINDOW_MS,
  lockMs = DEFAULT_LOCK_MS,
} = {}) {
  // key -> { count, firstAt, lockedUntil }
  const buckets = new Map();
  const keyFor = (identifier, ip) => `${identifier}|${ip}`;

  // Drop buckets that are no longer locked AND whose failure window has elapsed.
  // Without this the Map grows unbounded, since the key includes the
  // attacker-controlled identifier (a credential-stuffing run churns many).
  const SWEEP_THRESHOLD = 5000;
  function sweepIfLarge() {
    if (buckets.size < SWEEP_THRESHOLD) return;
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.lockedUntil <= now && now - bucket.firstAt > windowMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    // Returns { allowed } or { allowed:false, retryAfterMs } when locked.
    check(identifier, ip) {
      const bucket = buckets.get(keyFor(identifier, ip));
      const now = Date.now();
      if (bucket && bucket.lockedUntil > now) {
        return { allowed: false, retryAfterMs: bucket.lockedUntil - now };
      }
      return { allowed: true };
    },

    // Count a failed login; lock the key once it crosses the threshold.
    recordFailure(identifier, ip) {
      sweepIfLarge();
      const key = keyFor(identifier, ip);
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.firstAt > windowMs) {
        bucket = { count: 0, firstAt: now, lockedUntil: 0 };
      }
      bucket.count += 1;
      if (bucket.count >= maxFailed) {
        bucket.lockedUntil = now + lockMs;
        // Restart the window after locking so the next burst is measured fresh.
        bucket.count = 0;
        bucket.firstAt = now;
      }
      buckets.set(key, bucket);
    },

    // A successful login clears the key's failure history.
    recordSuccess(identifier, ip) {
      buckets.delete(keyFor(identifier, ip));
    },
  };
}
