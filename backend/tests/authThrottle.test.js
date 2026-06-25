import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const { createLoginThrottle } = await import('../services/authThrottle.js');

test('tier 1: identifier+IP locks independently per IP', () => {
  const t = createLoginThrottle({ maxFailed: 2, lockMs: 1000, windowMs: 60000, idMaxFailed: 100, idWindowMs: 60000, idLockMs: 1000 });
  t.recordFailure('a@x.com', '1.1.1.1');
  t.recordFailure('a@x.com', '1.1.1.1');
  assert.equal(t.check('a@x.com', '1.1.1.1').allowed, false, 'the failing IP is locked');
  assert.equal(t.check('a@x.com', '2.2.2.2').allowed, true, 'a different IP is not locked by tier 1');
});

test('tier 2: identifier-only lock applies across all IPs (A2b: IP rotation cannot bypass)', () => {
  const t = createLoginThrottle({ maxFailed: 100, lockMs: 1000, windowMs: 60000, idMaxFailed: 3, idWindowMs: 60000, idLockMs: 5000 });
  t.recordFailure('b@x.com', '1.1.1.1');
  t.recordFailure('b@x.com', '2.2.2.2');
  t.recordFailure('b@x.com', '3.3.3.3'); // 3 distinct IPs, none hit tier-1 limit, but tier-2 does
  assert.equal(t.check('b@x.com', '9.9.9.9').allowed, false, 'a brand-new IP is still locked by the identifier tier');
  assert.equal(t.check('other@x.com', '9.9.9.9').allowed, true, 'a different identifier is unaffected');
});

test('a successful login clears both tiers for that identifier across ALL its IPs', () => {
  const t = createLoginThrottle({ maxFailed: 2, idMaxFailed: 3, idLockMs: 5000, windowMs: 60000, idWindowMs: 60000, lockMs: 5000 });
  t.recordFailure('c@x.com', '1.1.1.1');
  t.recordFailure('c@x.com', '1.1.1.1'); // tier-1 locks 1.1.1.1
  t.recordFailure('c@x.com', '2.2.2.2'); // 3rd identifier failure -> tier-2 locks
  assert.equal(t.check('c@x.com', '1.1.1.1').allowed, false, 'old IP is tier-1 locked');
  assert.equal(t.check('c@x.com', '9.9.9.9').allowed, false, 'any IP is tier-2 locked');
  t.recordSuccess('c@x.com', '3.3.3.3'); // owner logs in from a new device
  assert.equal(t.check('c@x.com', '1.1.1.1').allowed, true, 'tier-1 lock on the old IP is cleared too');
  assert.equal(t.check('c@x.com', '2.2.2.2').allowed, true);
  assert.equal(t.check('c@x.com', '9.9.9.9').allowed, true, 'identifier tier is cleared');
});

test('check() reports retryAfterMs while locked', () => {
  const t = createLoginThrottle({ maxFailed: 1, lockMs: 1000, windowMs: 60000, idMaxFailed: 100, idWindowMs: 60000, idLockMs: 1000 });
  t.recordFailure('d@x.com', '1.1.1.1');
  const gate = t.check('d@x.com', '1.1.1.1');
  assert.equal(gate.allowed, false);
  assert.ok(gate.retryAfterMs > 0 && gate.retryAfterMs <= 1000, 'retryAfterMs is within the lock window');
});
