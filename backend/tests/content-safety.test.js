import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-safety-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [safety, dbModule] = await Promise.all([
  import('../services/contentSafety.js'),
  import('../core/db.js'),
]);

await dbModule.dbReady;

test.after(async () => {
  // Always clear the provider so a leaked registration can't affect other files.
  safety.setModerationProvider(null);
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('logSafetyEvent persists and loadSafetyEvents reads back newest-first', async () => {
  await safety.logSafetyEvent({ userId: 'u1', scope: 'chat_input', category: 'explicit', matched: '色情', action: 'blocked' });
  await safety.logSafetyEvent({ userId: 'u1', scope: 'ai_output', category: 'risk', matched: '传销', action: 'replaced' });

  const events = await safety.loadSafetyEvents(10);
  assert.equal(events.length, 2);
  assert.equal(events[0].scope, 'ai_output'); // newest first
  assert.equal(events[0].action, 'replaced');
  assert.equal(events[1].category, 'explicit');
});

test('moderateText falls back to the wordlist when no provider is registered', async () => {
  safety.setModerationProvider(null);
  assert.equal(safety.hasModerationProvider(), false);

  const blocked = await safety.moderateText('我想看色情内容');
  assert.equal(blocked.safe, false);
  assert.equal(blocked.source, 'wordlist');

  const ok = await safety.moderateText('今天天气真好呀');
  assert.equal(ok.safe, true);
  assert.equal(ok.source, 'wordlist');
});

test('a registered provider can escalate a wordlist-clean message to blocked', async () => {
  safety.setModerationProvider(async (text) => ({
    safe: !text.includes('暗号'),
    matched: '暗号',
    category: 'external',
  }));
  assert.equal(safety.hasModerationProvider(), true);

  const verdict = await safety.moderateText('这是一个暗号');
  assert.equal(verdict.safe, false);
  assert.equal(verdict.source, 'provider');
  assert.equal(verdict.category, 'external');

  safety.setModerationProvider(null);
});

test('a wordlist hit is authoritative and short-circuits before the provider', async () => {
  let providerCalled = false;
  safety.setModerationProvider(async () => {
    providerCalled = true;
    return { safe: true };
  });

  const verdict = await safety.moderateText('贩毒渠道'); // 'illegal' wordlist hit
  assert.equal(verdict.safe, false);
  assert.equal(verdict.source, 'wordlist');
  assert.equal(providerCalled, false, 'provider must not be able to downgrade a wordlist hit');

  safety.setModerationProvider(null);
});

test('a provider error falls back to the wordlist verdict (never fails open)', async () => {
  safety.setModerationProvider(async () => {
    throw new Error('provider timeout');
  });

  const verdict = await safety.moderateText('完全正常的一句话');
  assert.equal(verdict.safe, true); // wordlist baseline was clean
  assert.equal(verdict.source, 'wordlist-fallback');

  safety.setModerationProvider(null);
});

test('countRecentSafetyEvents counts a user\'s recent blocks', async () => {
  for (let i = 0; i < 3; i += 1) {
    await safety.logSafetyEvent({ userId: 'counter', scope: 'chat_input', category: 'explicit', matched: '色情' });
  }
  assert.equal(await safety.countRecentSafetyEvents('counter'), 3);
  assert.equal(await safety.countRecentSafetyEvents('nobody'), 0);
  assert.equal(await safety.countRecentSafetyEvents(null), 0);
});

test('assessAbuse flags a repeat offender once prior blocks reach the threshold', async () => {
  // Default threshold = 5: 4 priors → this hit is the 5th → flagged.
  for (let i = 0; i < 4; i += 1) {
    await safety.logSafetyEvent({ userId: 'abuser', scope: 'chat_input', category: 'illegal', matched: '贩毒' });
  }
  const hot = await safety.assessAbuse('abuser');
  assert.equal(hot.flagged, true);
  assert.equal(hot.recentCount, 5);
  assert.equal(hot.action, 'flagged');

  const cool = await safety.assessAbuse('first-timer');
  assert.equal(cool.flagged, false);
  assert.equal(cool.recentCount, 1);
  assert.equal(cool.action, 'blocked');
});

test('classifyRiskTopic maps categories to topic + severity', () => {
  assert.deepEqual(safety.classifyRiskTopic('selfharm'), { topic: 'self_harm', severity: 'critical' });
  assert.deepEqual(safety.classifyRiskTopic('minor_protection'), { topic: 'minor_protection', severity: 'critical' });
  assert.deepEqual(safety.classifyRiskTopic('unknown-cat'), { topic: 'other', severity: 'low' });
});
