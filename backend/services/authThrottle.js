import { resolvePositiveIntEnv } from '../core/envUtils.js';

// Login brute-force throttle. The global per-IP rate limiter is coarse and shared
// across all routes; this adds focused failed-attempt lockouts so credential
// stuffing against a single account is expensive, without penalizing unrelated
// traffic. In-memory (single-instance) — mirrors the existing rate limiter; a
// multi-instance deployment would back this with a shared store (e.g. Redis).
//
// Two tiers:
//   1. identifier+IP — locks one account from one IP after a few failures.
//   2. identifier ONLY — locks an account across ALL IPs after more failures,
//      so an attacker rotating IPs (backlog A2b) can't sidestep tier 1. Uses a
//      higher threshold and longer lock so legitimate users (who occasionally
//      mistype from one IP) are not caught by the cross-IP tier.
const DEFAULT_MAX_FAILED = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // failures counted within this window
const DEFAULT_LOCK_MS = 60 * 1000; // lockout duration once the threshold is hit

const DEFAULT_ID_MAX_FAILED = 10; // across all IPs
const DEFAULT_ID_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_ID_LOCK_MS = 10 * 60 * 1000; // 10 minutes

export function createLoginThrottle({
  maxFailed = DEFAULT_MAX_FAILED,
  windowMs = DEFAULT_WINDOW_MS,
  lockMs = DEFAULT_LOCK_MS,
  idMaxFailed = resolvePositiveIntEnv(process.env.LOGIN_THROTTLE_IDENTIFIER_MAX_FAILED, DEFAULT_ID_MAX_FAILED),
  idWindowMs = resolvePositiveIntEnv(process.env.LOGIN_THROTTLE_IDENTIFIER_WINDOW_MS, DEFAULT_ID_WINDOW_MS),
  idLockMs = resolvePositiveIntEnv(process.env.LOGIN_THROTTLE_IDENTIFIER_LOCK_MS, DEFAULT_ID_LOCK_MS),
} = {}) {
  // key -> { count, firstAt, lockedUntil }
  const buckets = new Map(); // keyed by `${identifier}|${ip}`
  const idBuckets = new Map(); // keyed by identifier alone
  const keyFor = (identifier, ip) => `${identifier}|${ip}`;

  // Drop buckets that are no longer locked AND whose failure window has elapsed.
  // Without this the Maps grow unbounded, since the keys include the
  // attacker-controlled identifier (a credential-stuffing run churns many).
  const SWEEP_THRESHOLD = 5000;
  function sweepMap(map, window) {
    const now = Date.now();
    for (const [key, bucket] of map) {
      if (bucket.lockedUntil <= now && now - bucket.firstAt > window) {
        map.delete(key);
      }
    }
  }
  function sweepIfLarge() {
    if (buckets.size >= SWEEP_THRESHOLD) sweepMap(buckets, windowMs);
    if (idBuckets.size >= SWEEP_THRESHOLD) sweepMap(idBuckets, idWindowMs);
  }

  // Count a failure against one bucket map; lock it once it crosses `limit`.
  function recordIn(map, key, window, limit, lock) {
    const now = Date.now();
    let bucket = map.get(key);
    if (!bucket || now - bucket.firstAt > window) {
      bucket = { count: 0, firstAt: now, lockedUntil: 0 };
    }
    bucket.count += 1;
    if (bucket.count >= limit) {
      bucket.lockedUntil = now + lock;
      // Restart the window after locking so the next burst is measured fresh.
      bucket.count = 0;
      bucket.firstAt = now;
    }
    map.set(key, bucket);
  }

  function lockedRemaining(bucket) {
    if (!bucket) return 0;
    const now = Date.now();
    return bucket.lockedUntil > now ? bucket.lockedUntil - now : 0;
  }

  return {
    // Returns { allowed } or { allowed:false, retryAfterMs } when EITHER tier is
    // locked (the longer remaining lock wins for the retry hint).
    check(identifier, ip) {
      const ipRemaining = lockedRemaining(buckets.get(keyFor(identifier, ip)));
      const idRemaining = lockedRemaining(idBuckets.get(identifier));
      const retryAfterMs = Math.max(ipRemaining, idRemaining);
      if (retryAfterMs > 0) {
        return { allowed: false, retryAfterMs };
      }
      return { allowed: true };
    },

    // Count a failed login against both tiers.
    recordFailure(identifier, ip) {
      sweepIfLarge();
      recordIn(buckets, keyFor(identifier, ip), windowMs, maxFailed, lockMs);
      recordIn(idBuckets, identifier, idWindowMs, idMaxFailed, idLockMs);
    },

    // A successful login clears this identifier's failure history on BOTH tiers
    // (a correct credential proves the owner is present, so don't keep them
    // locked out across their own devices). Tier 1 is cleared for EVERY IP of
    // this identifier, not just the IP that just succeeded — otherwise the owner
    // would stay locked out on their other devices.
    recordSuccess(identifier) {
      const prefix = `${identifier}|`;
      for (const key of buckets.keys()) {
        if (key.startsWith(prefix)) buckets.delete(key);
      }
      idBuckets.delete(identifier);
    },
  };
}
