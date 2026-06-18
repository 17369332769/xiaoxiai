import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.OPENAI_API_KEY = '';
process.env.ALLOWED_ORIGIN = 'http://localhost:5173';
process.env.RATE_LIMIT_MAX_REQUESTS = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-api-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([
  import('../server.js'),
  import('../db.js'),
]);

await dbModule.dbReady;
const { dbRun } = dbModule;

let server;
let baseUrl;

async function postJson(route, payload, origin = process.env.ALLOWED_ORIGIN) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('user sync creates a new profile and returns standard success shape', async () => {
  const result = await postJson('/api/user/sync', { userId: 'test_user_sync' });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.user.level, 1);
  assert.equal(result.body.user.coins, 200);
  assert.equal(Array.isArray(result.body.tasks), true);
  assert.equal(result.body.tasks.length, 4);
  assert.equal(Array.isArray(result.body.chatHistory), true);
});

test('chat rejects invalid text with structured error response', async () => {
  const result = await postJson('/api/chat', {
    userId: 'test_user_sync',
    text: ' '.repeat(3),
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, 'INVALID_TEXT');
});

test('checkin succeeds once and then returns a stable business error', async () => {
  const first = await postJson('/api/checkin', { userId: 'test_user_sync' });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.aiMsg.sender, 'ai');

  const second = await postJson('/api/checkin', { userId: 'test_user_sync' });
  assert.equal(second.status, 400);
  assert.equal(second.body.ok, false);
  assert.equal(second.body.error.code, 'ALREADY_CHECKED_IN');
});

test('feed rejects unknown items and succeeds with a valid shop item', async () => {
  const invalid = await postJson('/api/action/feed', {
    userId: 'test_user_sync',
    foodId: 'unknown_food',
  });

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.ok, false);
  assert.equal(invalid.body.error.code, 'INVALID_PARAMETER');

  const valid = await postJson('/api/action/feed', {
    userId: 'test_user_sync',
    foodId: 'coffee',
  });

  assert.equal(valid.status, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.aiMsg.avatarState, 'happy');
  assert.equal(valid.body.user.coins, 170);
  assert.equal(valid.body.tasks.find(task => task.id === 'feed_1')?.completed, true);
});

test('gift enforces coin checks for high-cost items', async () => {
  const result = await postJson('/api/action/gift', {
    userId: 'test_user_sync',
    giftId: 'ring',
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, 'INSUFFICIENT_COINS');
});

test('tip succeeds and returns updated user resources', async () => {
  const result = await postJson('/api/action/tip', {
    userId: 'test_user_sync',
    amount: 52,
    paymentMethod: 'wechat',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.user.coins, 1370);
  assert.equal(result.body.user.energy, 100);
  assert.equal(result.body.user.mood, 100);
  assert.equal(Array.isArray(result.body.systemMessages), true);
});

test('task claim only works after a task is completed', async () => {
  const userId = 'task_claim_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  const claimBeforeDone = await postJson('/api/task/claim', {
    userId,
    taskId: 'chat_3',
  });
  assert.equal(claimBeforeDone.status, 400);
  assert.equal(claimBeforeDone.body.error.code, 'TASK_NOT_CLAIMABLE');

  for (let i = 0; i < 3; i += 1) {
    const chat = await postJson('/api/chat', {
      userId,
      text: `测试对话 ${i + 1}`,
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
  }

  const claimAfterDone = await postJson('/api/task/claim', {
    userId,
    taskId: 'chat_3',
  });
  assert.equal(claimAfterDone.status, 200);
  assert.equal(claimAfterDone.body.ok, true);
  assert.equal(claimAfterDone.body.user.coins, 230);
  assert.equal(claimAfterDone.body.tasks.find(task => task.id === 'chat_3')?.claimed, true);
});

test('daily sync resets daily task progress and check-in state after day rollover', async () => {
  const userId = 'daily_reset_user';

  const firstSync = await postJson('/api/user/sync', { userId });
  assert.equal(firstSync.status, 200);

  const checkin = await postJson('/api/checkin', { userId });
  assert.equal(checkin.status, 200);

  const feed = await postJson('/api/action/feed', {
    userId,
    foodId: 'coffee',
  });
  assert.equal(feed.status, 200);

  await dbRun(
    'UPDATE users SET last_task_reset = ?, last_checkin = ? WHERE id = ?',
    ['2000/1/1', '2000/1/1', userId]
  );

  const secondSync = await postJson('/api/user/sync', { userId });
  assert.equal(secondSync.status, 200);
  assert.equal(secondSync.body.ok, true);
  assert.equal(secondSync.body.user.hasCheckedInToday, false);
  assert.equal(secondSync.body.tasks.find(task => task.id === 'checkin')?.progress, 0);
  assert.equal(secondSync.body.tasks.find(task => task.id === 'checkin')?.completed, false);
  assert.equal(secondSync.body.tasks.find(task => task.id === 'feed_1')?.progress, 0);
  assert.equal(secondSync.body.tasks.find(task => task.id === 'feed_1')?.completed, false);
});

test('high-value tip can trigger multiple level-up messages in one action', async () => {
  const userId = 'multi_level_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  await dbRun('UPDATE users SET affection = 90, level = 1 WHERE id = ?', [userId]);

  const tip = await postJson('/api/action/tip', {
    userId,
    amount: 131.4,
    paymentMethod: 'alipay',
  });

  assert.equal(tip.status, 200);
  assert.equal(tip.body.ok, true);
  assert.equal(tip.body.user.level, 5);
  assert.equal(Array.isArray(tip.body.systemMessages), true);
  assert.equal(tip.body.systemMessages.length, 4);
});

test('cors middleware blocks unexpected origins with structured error', async () => {
  const result = await postJson('/api/user/sync', { userId: 'cors_user_1' }, 'http://evil.local');

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, 'FORBIDDEN_ORIGIN');
});
