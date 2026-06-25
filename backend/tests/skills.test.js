import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.OPENAI_API_KEY = '';
process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';
// Start from a clean, predictable skill configuration regardless of the ambient env.
delete process.env.AI_SKILLS_ENABLED;
delete process.env.BOCHA_API_KEY;
delete process.env.WEATHER_ENABLED;
delete process.env.MEMORY_TOOL_ENABLED;

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-skills-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

// Importing the registry transitively opens the SQLite DB (memory skill), so the
// DB path must be set first. Then await readiness before exercising memory skills.
const [dbModule, registry, gameStatusModule, weatherModule, memoryModule] = await Promise.all([
  import('../core/db.js'),
  import('../skills/registry.js'),
  import('../skills/gameStatus.js'),
  import('../skills/weather.js'),
  import('../skills/memory.js'),
]);

await dbModule.dbReady;
const { dbRun } = dbModule;
const {
  areSkillsEnabled,
  getEnabledSkills,
  getToolSchemas,
  getSkillsPromptBlock,
  executeSkill,
} = registry;
const gameStatusSkill = gameStatusModule.default;
const weatherSkill = weatherModule.default;
const { rememberFactSkill, recallMemoriesSkill } = memoryModule;

const silentLogger = { info() {}, warn() {}, error() {} };

async function makeUser(userId) {
  await dbRun('INSERT OR IGNORE INTO users (id) VALUES (?)', [userId]);
}

// --- registry --------------------------------------------------------------

test('areSkillsEnabled honors the AI_SKILLS_ENABLED master switch', () => {
  process.env.AI_SKILLS_ENABLED = 'false';
  try {
    assert.equal(areSkillsEnabled(), false);
    assert.equal(getEnabledSkills().length, 0);
    assert.equal(getToolSchemas().length, 0);
    assert.equal(getSkillsPromptBlock(), '');
  } finally {
    delete process.env.AI_SKILLS_ENABLED;
  }
  assert.equal(areSkillsEnabled(), true);
});

test('getEnabledSkills reflects per-skill env gates', () => {
  delete process.env.BOCHA_API_KEY; // web_search off without a key
  const names = getEnabledSkills().map((s) => s.name);
  assert.ok(names.includes('get_game_status'), 'game status is always on');
  assert.ok(names.includes('get_weather'), 'weather on by default');
  assert.ok(names.includes('remember_fact'));
  assert.ok(names.includes('recall_memories'));
  assert.ok(!names.includes('web_search'), 'web_search stays off without BOCHA_API_KEY');

  process.env.WEATHER_ENABLED = 'false';
  try {
    assert.ok(!getEnabledSkills().map((s) => s.name).includes('get_weather'));
  } finally {
    delete process.env.WEATHER_ENABLED;
  }

  process.env.BOCHA_API_KEY = 'k';
  try {
    assert.ok(getEnabledSkills().map((s) => s.name).includes('web_search'));
  } finally {
    delete process.env.BOCHA_API_KEY;
  }
});

test('every enabled skill name matches its advertised schema function name', () => {
  for (const skill of getEnabledSkills()) {
    assert.equal(skill.schema.type, 'function');
    assert.equal(skill.schema.function.name, skill.name);
  }
});

test('getSkillsPromptBlock lists enabled hints and omits web search without a key', () => {
  delete process.env.BOCHA_API_KEY;
  const block = getSkillsPromptBlock();
  assert.match(block, /\[养成状态查询\]/);
  assert.match(block, /\[天气查询\]/);
  assert.doesNotMatch(block, /\[联网搜索能力\]/);
});

test('executeSkill degrades gracefully on an unknown skill name', async () => {
  const out = await executeSkill('does_not_exist', '{}', { logger: silentLogger });
  assert.match(out, /未知技能/);
});

test('executeSkill parses string args and tolerates malformed JSON', async () => {
  const user = { level: 2, affection: 10, energy: 50, mood: 50, coins: 0 };
  const ok = await executeSkill('get_game_status', '{}', { user, logger: silentLogger });
  assert.match(ok, /Lv\.2/);
  const malformed = await executeSkill('get_game_status', 'not-json', { user, logger: silentLogger });
  assert.match(malformed, /Lv\.2/);
});

// --- get_game_status -------------------------------------------------------

test('get_game_status reports real state from ctx.user', async () => {
  const status = await gameStatusSkill.handler(
    {},
    { user: { level: 3, affection: 42, energy: 80, mood: 65, coins: 250, checkin_streak: 5, login_streak: 7 } }
  );
  assert.match(status, /Lv\.3/);
  assert.match(status, /好感度：42/);
  assert.match(status, /小希体力：80\/100/);
  assert.match(status, /金币余额：250/);
  assert.match(status, /连续签到：5 天/);
  assert.match(status, /连续陪伴：7 天/);
});

test('get_game_status falls back to defaults for a sparse user', async () => {
  const status = await gameStatusSkill.handler({}, { user: {} });
  assert.match(status, /Lv\.1/);
  assert.doesNotMatch(status, /连续签到/);
});

// --- get_weather -----------------------------------------------------------

test('get_weather formats a successful lookup', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      current_condition: [
        { temp_C: '25', FeelsLikeC: '27', humidity: '60', lang_zh: [{ value: '晴' }], weatherDesc: [{ value: 'Sunny' }] },
      ],
      nearest_area: [{ areaName: [{ value: '北京' }] }],
    }),
  });
  try {
    const out = await weatherSkill.handler({ city: '北京' }, { logger: silentLogger });
    assert.match(out, /北京 当前天气：晴/);
    assert.match(out, /气温 25°C（体感 27°C）/);
    assert.match(out, /湿度 60%/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('get_weather degrades gracefully on an API error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const out = await weatherSkill.handler({ city: '上海' }, { logger: silentLogger });
    assert.match(out, /没查到/);
    assert.match(out, /上海/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('get_weather asks for a city when none is given', async () => {
  const out = await weatherSkill.handler({}, { logger: silentLogger });
  assert.match(out, /没有识别到城市/);
});

test('get_weather degrades when the payload has no current condition', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  try {
    const out = await weatherSkill.handler({ city: '广州' }, { logger: silentLogger });
    assert.match(out, /没查到/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('get_weather degrades gracefully when the request aborts/rejects', async () => {
  const originalFetch = globalThis.fetch;
  // Simulate the AbortController firing (timeout) or any network rejection.
  globalThis.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  try {
    const out = await weatherSkill.handler({ city: '深圳' }, { logger: silentLogger });
    assert.match(out, /没查到/);
    assert.match(out, /深圳/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('get_weather honors WEATHER_API_BASE and encodes the city', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ current_condition: [{ temp_C: '20', humidity: '40', lang_zh: [{ value: '阴' }] }] }),
    };
  };
  process.env.WEATHER_API_BASE = 'https://weather.example';
  try {
    await weatherSkill.handler({ city: '北 京' }, { logger: silentLogger });
    assert.ok(requestedUrl.startsWith('https://weather.example/'), 'uses the configured base');
    assert.match(requestedUrl, /%E5%8C%97/, 'city is percent-encoded');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.WEATHER_API_BASE;
  }
});

test('executeSkill falls back to empty args for a skill that reads them', async () => {
  // get_weather reads args.city, so a malformed JSON arg string must parse to {} and
  // surface the "missing city" message rather than crash — proving the parse fallback.
  const out = await executeSkill('get_weather', 'not-json', { logger: silentLogger });
  assert.match(out, /没有识别到城市/);
});

// --- memory skills ---------------------------------------------------------

test('remember_fact persists a fact that recall_memories reads back', async () => {
  const userId = 'skill_mem_user';
  await makeUser(userId);

  const remembered = await rememberFactSkill.handler(
    { key: 'favorite_food', value: '红丝绒蛋糕' },
    { userId, logger: silentLogger }
  );
  assert.match(remembered, /已经悄悄记住/);
  assert.match(remembered, /红丝绒蛋糕/);

  const recalled = await recallMemoriesSkill.handler({}, { userId, logger: silentLogger });
  assert.match(recalled, /红丝绒蛋糕/);
});

test('remember_fact rejects an incomplete fact without recording it', async () => {
  const userId = 'skill_mem_user_2';
  await makeUser(userId);

  const result = await rememberFactSkill.handler(
    { key: 'note', value: '   ' },
    { userId, logger: silentLogger }
  );
  assert.match(result, /先不记了/);

  const recalled = await recallMemoriesSkill.handler({}, { userId, logger: silentLogger });
  assert.match(recalled, /还没有记住/);
});

test('executeSkill routes to a registered skill handler', async () => {
  const userId = 'skill_mem_user_3';
  await makeUser(userId);
  const out = await executeSkill(
    'remember_fact',
    JSON.stringify({ key: 'hobby', value: '弹吉他' }),
    { userId, logger: silentLogger }
  );
  assert.match(out, /已经悄悄记住/);
});
