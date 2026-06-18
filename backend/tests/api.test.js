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
const {
  buildChatSystemPrompt,
  buildMemoryContextPrompt,
  buildReplyFocusPrompt,
  categorizeMemories,
  generateAiResponse,
} = await import('../apiRoutes.js');

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
  assert.equal(typeof result.body.relationship.summary, 'string');
  assert.equal(Array.isArray(result.body.relationship.highlights), true);
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

test('chat can surface locally consolidated relationship memory after enough conversation', async () => {
  const userId = 'relationship_memory_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  const lines = [
    '我最近喜欢喝拿铁，感觉咖啡能让我放松一点。',
    '我平时喜欢编程，也会经常写代码到很晚。',
    '最近在准备面试，所以有点累。',
  ];

  for (const text of lines) {
    const chat = await postJson('/api/chat', { userId, text });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
  }

  const finalChat = await postJson('/api/chat', {
    userId,
    text: '其实我真的很想让你记住我喜欢什么。',
  });

  assert.equal(finalChat.status, 200);
  assert.equal(finalChat.body.ok, true);
  assert.equal(typeof finalChat.body.relationship.summary, 'string');
  assert.ok(finalChat.body.relationship.summary.length > 0);
  assert.equal(Array.isArray(finalChat.body.relationship.highlights), true);
  assert.ok(finalChat.body.relationship.highlights.some((item) => item.key === 'favorite_drink'));
  assert.equal(Array.isArray(finalChat.body.relationship.recentUpdates), true);
  assert.ok(finalChat.body.relationship.recentUpdates.length > 0);
  assert.ok(finalChat.body.relationship.recentUpdates.some((item) => item.text.includes('常喝饮品')));
  assert.ok(finalChat.body.relationship.recentUpdates.some((item) => item.sourceType === 'local_memory'));
  assert.ok(finalChat.body.relationship.recentUpdates.some((item) => item.confidenceLabel === '高可信'));
});

test('weaker local memory matches are marked as low confidence in the relationship timeline', async () => {
  const userId = 'relationship_low_confidence_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  const lines = [
    '最近有点忙，脑子也有点乱。',
    '我喜欢喝拿铁。',
    '平时也会写代码到很晚。',
    '希望你能继续慢慢记住我的状态。',
  ];

  for (const text of lines) {
    const chat = await postJson('/api/chat', { userId, text });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
  }

  const refreshSync = await postJson('/api/user/sync', { userId });
  assert.equal(refreshSync.status, 200);
  assert.equal(refreshSync.body.ok, true);

  const stressEvent = refreshSync.body.relationship.recentUpdates.find((item) => item.text.includes('最近状态'));
  assert.ok(stressEvent);
  assert.equal(stressEvent.confidence, 'low');
  assert.equal(stressEvent.confidenceLabel, '低可信');
});

test('relationship memory timeline survives a later sync after being persisted', async () => {
  const userId = 'relationship_timeline_persist_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  const lines = [
    '我最近最喜欢喝拿铁。',
    '最近在准备考研，所以有点累。',
    '我平时也挺喜欢摄影的。',
    '希望你能慢慢记住这些事情。',
  ];

  for (const text of lines) {
    const chat = await postJson('/api/chat', { userId, text });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
  }

  const refreshSync = await postJson('/api/user/sync', { userId });
  assert.equal(refreshSync.status, 200);
  assert.equal(refreshSync.body.ok, true);
  assert.equal(Array.isArray(refreshSync.body.relationship.recentUpdates), true);
  assert.ok(refreshSync.body.relationship.recentUpdates.length > 0);
  assert.ok(refreshSync.body.relationship.recentUpdates.some((item) => item.text.includes('常喝饮品')));
  assert.ok(refreshSync.body.relationship.recentUpdates.some((item) => item.sourceLabel === '规则提取'));
});

test('relationship memory timeline deduplicates repeated nearby events', async () => {
  const userId = 'relationship_timeline_dedupe_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  const messages = [
    '我最喜欢喝拿铁。',
    '最近在准备面试，有点累。',
    '今天还是想让你记住我最喜欢喝拿铁。',
    '我真的很爱拿铁，再记一下也没关系。',
  ];

  for (const text of messages) {
    const chat = await postJson('/api/chat', { userId, text });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
  }

  const refreshSync = await postJson('/api/user/sync', { userId });
  assert.equal(refreshSync.status, 200);
  const drinkEvents = refreshSync.body.relationship.recentUpdates.filter((item) => item.text.includes('常喝饮品'));
  assert.equal(drinkEvents.length, 1);
});

test('relationship memory timeline prunes older events beyond retention limit', async () => {
  const userId = 'relationship_timeline_prune_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  for (let index = 0; index < 39; index += 1) {
    await dbRun(
      `INSERT INTO relationship_memory_events (id, user_id, category, category_label, text)
       VALUES (?, ?, ?, ?, ?)`,
      [
        `seed-memory-${index}`,
        userId,
        'preference',
        '偏好',
        `小希刚记住了你的常喝饮品：拿铁${index}`,
      ]
    );
  }

  const messages = [
    '我最喜欢喝奶茶。',
    '最近在准备考研，所以有点累。',
    '我平时也很喜欢摄影。',
    '希望你继续记住我新的喜好。',
  ];

  for (const text of messages) {
    const chat = await postJson('/api/chat', { userId, text });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
  }

  const dbEvents = await dbModule.dbAll(
    'SELECT text FROM relationship_memory_events WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    [userId]
  );

  assert.equal(dbEvents.length, 40);
  assert.equal(dbEvents.some((item) => item.text.includes('奶茶')), true);
});

test('local fallback replies can reference remembered drink and current stress context', async () => {
  const userId = 'memory_aware_reply_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  await dbRun('UPDATE users SET summary = ? WHERE id = ?', ['你最近有点累，但还是会来找小希聊天。', userId]);
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'favorite_drink', '拿铁']
  );
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'stress_signal', '最近有点累，想被温柔安慰']
  );

  const drinkReply = await postJson('/api/chat', {
    userId,
    text: '今天突然好想喝点东西。',
  });

  assert.equal(drinkReply.status, 200);
  assert.equal(drinkReply.body.ok, true);
  assert.match(drinkReply.body.aiMessage.text, /拿铁/);

  const comfortReply = await postJson('/api/chat', {
    userId,
    text: '我现在有点累。',
  });

  assert.equal(comfortReply.status, 200);
  assert.equal(comfortReply.body.ok, true);
  assert.match(comfortReply.body.aiMessage.text, /最近状态不算轻松|想被温柔安慰/);
});

test('local fallback replies can combine goal encouragement with stress comfort', async () => {
  const userId = 'goal_and_stress_reply_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'study_goal', '前端面试']
  );
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'stress_signal', '最近有点累，想被温柔安慰']
  );

  const reply = await postJson('/api/chat', {
    userId,
    text: '今天还得继续准备面试，但是真的有点累。',
  });

  assert.equal(reply.status, 200);
  assert.equal(reply.body.ok, true);
  assert.match(reply.body.aiMessage.text, /前端面试/);
  assert.match(reply.body.aiMessage.text, /累|缓一缓|抱抱/);
});

test('local fallback hobby replies can mention remembered hobby and role context', async () => {
  const userId = 'hobby_memory_reply_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'hobby', '摄影']
  );
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'job', '设计师']
  );

  const reply = await postJson('/api/chat', {
    userId,
    text: '你觉得我平时都怎么放松比较好呀？',
  });

  assert.equal(reply.status, 200);
  assert.equal(reply.body.ok, true);
  assert.match(reply.body.aiMessage.text, /摄影/);
  assert.match(reply.body.aiMessage.text, /设计师|认真/);
});

test('local fallback food replies can blend preference memory with goal context', async () => {
  const userId = 'food_goal_reply_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'favorite_food', '火锅']
  );
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'study_goal', '考研']
  );

  const reply = await postJson('/api/chat', {
    userId,
    text: '突然好想吃点东西，安慰一下自己。',
  });

  assert.equal(reply.status, 200);
  assert.equal(reply.body.ok, true);
  assert.match(reply.body.aiMessage.text, /火锅/);
  assert.match(reply.body.aiMessage.text, /考研|庆祝|忙完/);
});

test('memory prompt helpers categorize long-term memories by relationship use', () => {
  const memories = [
    { memory_key: 'favorite_drink', memory_value: '拿铁' },
    { memory_key: 'study_goal', memory_value: '前端面试' },
    { memory_key: 'stress_signal', memory_value: '最近有点累，想被温柔安慰' },
    { memory_key: 'job', memory_value: '程序员' },
  ];

  const categorized = categorizeMemories(memories);
  assert.equal(categorized.preference.length, 1);
  assert.equal(categorized.goal.length, 1);
  assert.equal(categorized.status.length, 1);
  assert.equal(categorized.profile.length, 1);

  const memoryContext = buildMemoryContextPrompt(memories);
  assert.match(memoryContext, /\[偏好与习惯\]/);
  assert.match(memoryContext, /favorite_drink: 拿铁/);
  assert.match(memoryContext, /\[近期目标与计划\]/);
  assert.match(memoryContext, /study_goal: 前端面试/);
  assert.match(memoryContext, /\[最近状态与安慰线索\]/);
  assert.match(memoryContext, /stress_signal: 最近有点累/);
  assert.match(memoryContext, /\[其他重要事实\]/);
  assert.match(memoryContext, /job: 程序员/);

  const stressFocus = buildReplyFocusPrompt('我今天有点累。', memories);
  assert.match(stressFocus, /优先参考“最近状态与安慰线索”/);

  const goalFocus = buildReplyFocusPrompt('今天准备继续复习面试。', memories);
  assert.match(goalFocus, /优先参考“近期目标与计划”/);

  const preferenceFocus = buildReplyFocusPrompt('突然想喝点东西。', memories);
  assert.match(preferenceFocus, /优先参考“偏好与习惯”/);
});

test('llm system prompt includes categorized memory sections and topic focus guidance', async () => {
  const userId = 'llm_prompt_user';

  const sync = await postJson('/api/user/sync', { userId });
  assert.equal(sync.status, 200);

  await dbRun('UPDATE users SET summary = ? WHERE id = ?', ['你最近在准备前端面试，小希想多鼓励你。', userId]);
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'favorite_drink', '拿铁']
  );
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'study_goal', '前端面试']
  );
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key)
     DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP`,
    [userId, 'stress_signal', '最近有点累，想被温柔安慰']
  );

  const user = { summary: '你最近在准备前端面试，小希想多鼓励你。' };
  const llmCalls = [];
  const openai = {
    chat: {
      completions: {
        create: async (payload) => {
          llmCalls.push(payload);
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    reply: '我记得你最近在准备前端面试，累了就先来抱抱，小希会陪着你。',
                    emotion: 'happy',
                    affection_bump: 3,
                    mood_bump: 5,
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };

  const response = await generateAiResponse(
    openai,
    user,
    userId,
    '今天准备继续复习面试，但是有点累。',
    { warn() {}, error() {} }
  );

  assert.equal(response.emotion, 'happy');
  assert.equal(llmCalls.length, 1);
  const systemMessage = llmCalls[0].messages[0].content;
  assert.match(systemMessage, /\[偏好与习惯\]/);
  assert.match(systemMessage, /favorite_drink: 拿铁/);
  assert.match(systemMessage, /\[近期目标与计划\]/);
  assert.match(systemMessage, /study_goal: 前端面试/);
  assert.match(systemMessage, /\[最近状态与安慰线索\]/);
  assert.match(systemMessage, /stress_signal: 最近有点累/);
  assert.match(systemMessage, /优先参考“近期目标与计划”/);
});

test('buildChatSystemPrompt falls back to empty-state memory sections cleanly', () => {
  const prompt = buildChatSystemPrompt(
    { summary: '' },
    [],
    '只是想和你聊聊天。'
  );

  assert.match(prompt, /前文历史与关系大意摘要: "无"/);
  assert.match(prompt, /\[偏好与习惯\]/);
  assert.match(prompt, /- 暂无记录/);
  assert.match(prompt, /如果没有合适的长期记忆，就根据当前对话自然回应/);
});
