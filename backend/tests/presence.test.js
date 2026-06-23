import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceTracker } from '../presence.js';

test('presence counts active heartbeats and blends the display baseline', () => {
  const presence = createPresenceTracker({ ttlMs: 1000, baseline: 5 });
  assert.equal(presence.count(), 0);
  assert.equal(presence.displayCount(), 5); // baseline only when nobody is online

  presence.touch('a');
  presence.touch('b');
  presence.touch('a'); // re-ping is idempotent (same user)
  assert.equal(presence.count(), 2);
  assert.equal(presence.displayCount(), 7);
});

test('presence ignores falsy user ids', () => {
  const presence = createPresenceTracker();
  presence.touch('');
  presence.touch(null);
  presence.touch(undefined);
  assert.equal(presence.count(), 0);
});

test('presence prunes users whose heartbeat is older than the TTL', () => {
  const presence = createPresenceTracker({ ttlMs: 1000, baseline: 0 });
  presence.touch('a');
  presence.touch('b');
  assert.equal(presence.count(), 2);

  // Advance "now" past the TTL window → both fall offline.
  presence.prune(Date.now() + 5000);
  assert.equal(presence.count(), 0);
  assert.equal(presence.displayCount(), 0);
});
