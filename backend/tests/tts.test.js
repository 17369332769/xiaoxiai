import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';
process.env.RUNNINGHUB_API_KEY = 'test-key';
process.env.RUNNINGHUB_TTS_ENDPOINT = 'https://www.runninghub.cn/openapi/v2/run/ai-app/APP1';
process.env.RUNNINGHUB_TTS_QUERY_ENDPOINT = 'https://www.runninghub.cn/openapi/v2/query';
process.env.RUNNINGHUB_TTS_TEXT_NODE_ID = '6';
process.env.RUNNINGHUB_TTS_TEXT_FIELD = 'text';
process.env.RUNNINGHUB_TTS_NODE_INFO = '[{"nodeId":"9","fieldName":"audio","fieldValue":"voice.mp3"},{"nodeId":"17","fieldName":"text","fieldValue":"温柔的"}]';

const tts = await import('../tts.js');

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

test('isTtsEnabled requires both the apiKey and the run endpoint', () => {
  assert.equal(tts.isTtsEnabled(), true);
  const prev = process.env.RUNNINGHUB_TTS_ENDPOINT;
  delete process.env.RUNNINGHUB_TTS_ENDPOINT;
  assert.equal(tts.isTtsEnabled(), false);
  process.env.RUNNINGHUB_TTS_ENDPOINT = prev;
});

test('synthesizeSpeech posts nodeInfoList (text + fixed voice nodes), polls, returns audio URL', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.includes('/run/ai-app/')) {
      return { json: async () => ({ taskId: 't1', status: 'RUNNING', results: null }) };
    }
    const queries = calls.filter((c) => c.url.includes('/openapi/v2/query')).length;
    if (queries === 1) return { json: async () => ({ taskId: 't1', status: 'RUNNING', results: null }) };
    return { json: async () => ({ taskId: 't1', status: 'SUCCESS', results: [{ url: 'https://cdn/voice.flac', nodeId: '4', outputType: 'flac', text: null }] }) };
  };

  const result = await tts.synthesizeSpeech('你好呀', { pollIntervalMs: 5, maxWaitMs: 3000 });
  assert.equal(result.ok, true);
  assert.equal(result.audioUrl, 'https://cdn/voice.flac');

  const start = calls.find((c) => c.url.includes('/run/ai-app/'));
  assert.equal(start.headers.Authorization, 'Bearer test-key');
  // The reply text is injected at the text node, alongside the fixed voice nodes.
  const textNode = start.body.nodeInfoList.find((n) => n.nodeId === '6');
  assert.equal(textNode.fieldName, 'text');
  assert.equal(textNode.fieldValue, '你好呀');
  assert.ok(start.body.nodeInfoList.some((n) => n.nodeId === '9' && n.fieldValue === 'voice.mp3'));
  assert.ok(start.body.nodeInfoList.some((n) => n.nodeId === '17'));
  assert.equal(start.body.instanceType, 'default');

  const query = calls.find((c) => c.url.includes('/openapi/v2/query'));
  assert.equal(query.body.taskId, 't1');
  assert.equal(query.headers.Authorization, 'Bearer test-key');
});

test('synthesizeSpeech returns the URL immediately on a synchronous SUCCESS', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ status: 'SUCCESS', results: [{ url: 'https://cdn/sync.wav', outputType: 'wav' }] }) });
  const result = await tts.synthesizeSpeech('hi', { pollIntervalMs: 5, maxWaitMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.audioUrl, 'https://cdn/sync.wav');
});

test('synthesizeSpeech surfaces a FAILED task', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ status: 'FAILED', errorMessage: 'quota exceeded' }) });
  const result = await tts.synthesizeSpeech('测试', { pollIntervalMs: 5, maxWaitMs: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.error, /quota exceeded/);
});

test('synthesizeSpeech returns TTS_NOT_CONFIGURED when the endpoint is unset', async () => {
  const prev = process.env.RUNNINGHUB_TTS_ENDPOINT;
  delete process.env.RUNNINGHUB_TTS_ENDPOINT;
  const result = await tts.synthesizeSpeech('hi');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'TTS_NOT_CONFIGURED');
  process.env.RUNNINGHUB_TTS_ENDPOINT = prev;
});
