import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePositiveIntEnv } from '../envUtils.js';

test('resolvePositiveIntEnv returns the parsed value for a positive integer string', () => {
  assert.equal(resolvePositiveIntEnv('5', 99), 5);
  assert.equal(resolvePositiveIntEnv('300', 99), 300);
  assert.equal(resolvePositiveIntEnv('7abc', 99), 7); // parseInt stops at the first non-digit
});

test('resolvePositiveIntEnv falls back for missing, non-numeric, or non-positive values', () => {
  assert.equal(resolvePositiveIntEnv(undefined, 99), 99);
  assert.equal(resolvePositiveIntEnv('', 99), 99);
  assert.equal(resolvePositiveIntEnv('abc', 99), 99);
  assert.equal(resolvePositiveIntEnv('0', 99), 99);
  assert.equal(resolvePositiveIntEnv('-3', 99), 99);
});

test('resolvePositiveIntEnv supports a zero fallback (e.g. MEMORY_TTL_DAYS off)', () => {
  assert.equal(resolvePositiveIntEnv(undefined, 0), 0);
  assert.equal(resolvePositiveIntEnv('0', 0), 0);
  assert.equal(resolvePositiveIntEnv('14', 0), 14);
});
