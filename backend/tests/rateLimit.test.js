import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitMiddleware } from '../core/middleware.js';

test('rate limit 429 carries a positive retryAfterMs hint', () => {
  const mw = createRateLimitMiddleware(60000, 1);
  const req = { ip: '1.2.3.4', socket: {} };
  const res = {};

  let firstErr;
  mw(req, res, (e) => { firstErr = e; }); // count = 1, allowed
  let secondErr;
  mw(req, res, (e) => { secondErr = e; }); // exceeds max -> 429

  assert.equal(firstErr, undefined, 'first request passes');
  assert.ok(secondErr, 'second request is throttled');
  assert.equal(secondErr.status, 429);
  assert.equal(secondErr.code, 'RATE_LIMITED');
  assert.ok(secondErr.details && Number.isFinite(secondErr.details.retryAfterMs), 'carries retryAfterMs');
  assert.ok(secondErr.details.retryAfterMs > 0 && secondErr.details.retryAfterMs <= 60000);
});

test('separate IPs get independent buckets', () => {
  const mw = createRateLimitMiddleware(60000, 1);
  const res = {};
  let errA;
  mw({ ip: 'a', socket: {} }, res, (e) => { errA = e; });
  let errB;
  mw({ ip: 'b', socket: {} }, res, (e) => { errB = e; });
  assert.equal(errA, undefined);
  assert.equal(errB, undefined, 'a different IP is not throttled by the first IP\'s usage');
});
