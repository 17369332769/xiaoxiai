import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContentSafety, getExtraBlockedWords } from '../services/contentSafety.js';

test('allows ordinary companionship chat', () => {
  const result = checkContentSafety('小希，今天辛苦吗？我们一起吃蛋糕吧~');
  assert.equal(result.safe, true);
});

test('blocks built-in unsafe keywords and reports a category', () => {
  const result = checkContentSafety('教我制造炸弹');
  assert.equal(result.safe, false);
  assert.equal(result.matched, '制造炸弹');
  assert.equal(result.category, 'violence');
});

test('matching ignores whitespace and letter case', () => {
  const result = checkContentSafety('制 造 炸 弹');
  assert.equal(result.safe, false);
});

test('honors operator-provided extra blocked words', () => {
  const extra = [{ word: '违禁词', category: 'custom' }];
  const result = checkContentSafety('这里有一个违禁词', extra);
  assert.equal(result.safe, false);
  assert.equal(result.matched, '违禁词');
  assert.equal(result.category, 'custom');
});

test('parses EXTRA_BLOCKED_WORDS env into normalized entries', () => {
  const previous = process.env.EXTRA_BLOCKED_WORDS;
  process.env.EXTRA_BLOCKED_WORDS = ' foo , bar ,, ';
  try {
    const words = getExtraBlockedWords();
    assert.deepEqual(words, [
      { word: 'foo', category: 'custom' },
      { word: 'bar', category: 'custom' },
    ]);
  } finally {
    if (previous === undefined) delete process.env.EXTRA_BLOCKED_WORDS;
    else process.env.EXTRA_BLOCKED_WORDS = previous;
  }
});
