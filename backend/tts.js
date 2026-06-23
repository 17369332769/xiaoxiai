import { createLogger } from './logger.js';

// RunningHub text-to-speech via the "AI App" run API (apiType=4).
//
// Confirmed contract (Index-TTS voice-clone app):
//   POST <endpoint>                       Authorization: Bearer <apiKey>
//     body: { nodeInfoList:[{nodeId,fieldName,fieldValue}], instanceType, usePersonalQueue }
//   -> { taskId, status: QUEUED|RUNNING|SUCCESS|FAILED, results: null|[{url,outputType,...}] }
//   Poll: POST <queryEndpoint> { taskId } until SUCCESS; results[].url is the audio (URL valid ~24h).
//
// The reply text is injected into the text node; other nodes (clone-voice sample,
// emotion) are fixed "voice" config. All configured via env (from the app's API
// example):
//   RUNNINGHUB_API_KEY            account key (Bearer)
//   RUNNINGHUB_TTS_ENDPOINT       full run/ai-app URL
//   RUNNINGHUB_TTS_QUERY_ENDPOINT result/poll URL (default the standard one)
//   RUNNINGHUB_TTS_TEXT_NODE_ID   node that receives the spoken text (default "6")
//   RUNNINGHUB_TTS_TEXT_FIELD     that node's field name (default "text")
//   RUNNINGHUB_TTS_NODE_INFO      JSON array of fixed nodes (clone-voice sample, emotion, …)
//   RUNNINGHUB_TTS_INSTANCE_TYPE  "default" (24G) | "plus" (48G)
//   RUNNINGHUB_TTS_PERSONAL_QUEUE "true" | "false"

const logger = createLogger('tts');

function parseJsonEnv(raw, fallback) {
  if (!raw || !String(raw).trim()) return fallback;
  try {
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function ttsConfig() {
  return {
    apiKey: process.env.RUNNINGHUB_API_KEY || '',
    endpoint: process.env.RUNNINGHUB_TTS_ENDPOINT || '',
    queryEndpoint: process.env.RUNNINGHUB_TTS_QUERY_ENDPOINT || 'https://www.runninghub.cn/openapi/v2/query',
    textNodeId: process.env.RUNNINGHUB_TTS_TEXT_NODE_ID || '6',
    textField: process.env.RUNNINGHUB_TTS_TEXT_FIELD || 'text',
    fixedNodes: parseJsonEnv(process.env.RUNNINGHUB_TTS_NODE_INFO, []),
    instanceType: process.env.RUNNINGHUB_TTS_INSTANCE_TYPE || 'default',
    usePersonalQueue: process.env.RUNNINGHUB_TTS_PERSONAL_QUEUE || 'false',
  };
}

// Needs the key AND the run endpoint (the key alone can't say which app to run).
export function isTtsEnabled() {
  const { apiKey, endpoint } = ttsConfig();
  return Boolean(apiKey && endpoint);
}

async function postJson(url, body, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function audioUrlFrom(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (results.length === 0) return null;
  const audio = results.find((item) => /audio|mp3|wav|flac|m4a|ogg/i.test(`${item?.outputType || ''}${item?.url || ''}`));
  return (audio || results[0])?.url || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Synthesize speech for `text`. Returns { ok:true, audioUrl } or { ok:false, error }.
// Never throws — callers degrade to text-only on failure.
export async function synthesizeSpeech(text, { pollIntervalMs = 1500, maxWaitMs = 90000, requestTimeoutMs = 15000 } = {}) {
  const cfg = ttsConfig();
  if (!isTtsEnabled()) return { ok: false, error: 'TTS_NOT_CONFIGURED' };
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, error: 'EMPTY_TEXT' };

  const nodeInfoList = [
    ...(Array.isArray(cfg.fixedNodes) ? cfg.fixedNodes : []),
    { nodeId: cfg.textNodeId, fieldName: cfg.textField, fieldValue: clean },
  ];

  try {
    const started = await postJson(
      cfg.endpoint,
      { nodeInfoList, instanceType: cfg.instanceType, usePersonalQueue: cfg.usePersonalQueue },
      cfg.apiKey,
      requestTimeoutMs
    );
    const startStatus = String(started?.status || '').toUpperCase();

    if (startStatus === 'FAILED') {
      return { ok: false, error: started?.errorMessage || started?.errorCode || 'TASK_FAILED' };
    }
    const startUrl = audioUrlFrom(started);
    if (startStatus === 'SUCCESS' || startUrl) {
      return startUrl ? { ok: true, audioUrl: startUrl } : { ok: false, error: 'NO_AUDIO_OUTPUT' };
    }

    const taskId = started?.taskId;
    if (!taskId) {
      return { ok: false, error: started?.errorMessage || started?.errorCode || 'NO_TASK_ID' };
    }

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const polled = await postJson(cfg.queryEndpoint, { taskId }, cfg.apiKey, requestTimeoutMs);
      const status = String(polled?.status || '').toUpperCase();
      if (status === 'SUCCESS') {
        const url = audioUrlFrom(polled);
        return url ? { ok: true, audioUrl: url } : { ok: false, error: 'NO_AUDIO_OUTPUT' };
      }
      if (status === 'FAILED') {
        return { ok: false, error: polled?.errorMessage || polled?.errorCode || 'TASK_FAILED' };
      }
      // QUEUED / RUNNING → keep polling.
    }
    return { ok: false, error: 'TTS_TIMEOUT' };
  } catch (error) {
    logger.warn('RunningHub TTS error', { error: error.message });
    return { ok: false, error: error.message };
  }
}
