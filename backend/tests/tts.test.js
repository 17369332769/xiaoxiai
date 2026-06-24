import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';
process.env.MINIMAX_API_KEY = 'test-key';
process.env.MINIMAX_TTS_HOST = 'https://api.minimaxi.com';
process.env.MINIMAX_TTS_MODEL = 'speech-02-turbo';
process.env.MINIMAX_TTS_VOICE_ID = 'female-tianmei';
process.env.MINIMAX_TTS_FORMAT = 'mp3';

const tts = await import('../tts.js');

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

// "ID3" as hex — three bytes, lets us assert the hex→base64 decode is correct.
const ID3_HEX = '494433';
const ID3_BASE64 = Buffer.from('ID3').toString('base64');

test('isTtsEnabled requires the api key', () => {
  assert.equal(tts.isTtsEnabled(), true);
  const prev = process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_API_KEY;
  assert.equal(tts.isTtsEnabled(), false);
  process.env.MINIMAX_API_KEY = prev;
});

test('synthesizeSpeech posts t2a_v2 and returns the audio as a base64 data: URI', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return { json: async () => ({ data: { audio: ID3_HEX }, base_resp: { status_code: 0, status_msg: 'success' } }) };
  };

  const result = await tts.synthesizeSpeech('你好呀');
  assert.equal(result.ok, true);
  assert.equal(result.audioUrl, `data:audio/mpeg;base64,${ID3_BASE64}`);

  const call = calls[0];
  assert.equal(call.url, 'https://api.minimaxi.com/v1/t2a_v2');
  assert.equal(call.headers.Authorization, 'Bearer test-key');
  assert.equal(call.body.model, 'speech-02-turbo');
  assert.equal(call.body.text, '你好呀');
  assert.equal(call.body.stream, false);
  assert.equal(call.body.voice_setting.voice_id, 'female-tianmei');
  assert.equal(call.body.audio_setting.format, 'mp3');
});

test('synthesizeSpeech includes emotion only when configured', async () => {
  const prev = process.env.MINIMAX_TTS_EMOTION;
  process.env.MINIMAX_TTS_EMOTION = 'happy';
  let sent = null;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return { json: async () => ({ data: { audio: ID3_HEX }, base_resp: { status_code: 0 } }) };
  };
  await tts.synthesizeSpeech('嗯嗯');
  assert.equal(sent.voice_setting.emotion, 'happy');
  if (prev === undefined) delete process.env.MINIMAX_TTS_EMOTION;
  else process.env.MINIMAX_TTS_EMOTION = prev;
});

test('synthesizeSpeech surfaces a non-zero base_resp status', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ base_resp: { status_code: 2049, status_msg: 'invalid api key' } }) });
  const result = await tts.synthesizeSpeech('测试');
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid api key/);
});

test('synthesizeSpeech reports NO_AUDIO_OUTPUT when the success payload has no audio', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ data: {}, base_resp: { status_code: 0 } }) });
  const result = await tts.synthesizeSpeech('hi');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_AUDIO_OUTPUT');
});

test('synthesizeSpeech rejects empty text without calling the API', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { json: async () => ({}) }; };
  const result = await tts.synthesizeSpeech('   ');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'EMPTY_TEXT');
  assert.equal(called, false);
});

test('synthesizeSpeech returns TTS_NOT_CONFIGURED when the key is unset', async () => {
  const prev = process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_API_KEY;
  const result = await tts.synthesizeSpeech('hi');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'TTS_NOT_CONFIGURED');
  process.env.MINIMAX_API_KEY = prev;
});
