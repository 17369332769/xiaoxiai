// Cross-end network adapter — faithful port of the web `apiClient.js` semantics
// (unified {ok,error} envelope, per-request timeout, opt-in retry, Bearer auth)
// but built on Taro.request so it runs on H5 + mini-program + RN. The streaming
// path (postSse) is the one place the ends genuinely diverge: H5 uses fetch +
// ReadableStream; mini-program uses Taro.request({ enableChunked }) chunks.
import Taro from '@tarojs/taro';
import { getItem } from './storage';
import { API_BASE } from '../config';

export const DEFAULT_TIMEOUT_MS = 20000;

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

// Map an HTTP status + parsed body onto the app's error contract. Mirrors
// parseApiResponse() on the web: throw a rich Error on !ok / {ok:false}.
function parseEnvelope(statusCode, data) {
  const httpOk = statusCode >= 200 && statusCode < 300;
  if (!httpOk || data?.ok === false) {
    const message = data?.error?.message || '请求失败，请稍后重试。';
    const code = data?.error?.code || 'UNKNOWN_ERROR';
    const error = new Error(message);
    error.code = code;
    error.status = statusCode;
    error.details = data?.error?.details || null;
    if (error.details && Number.isFinite(error.details.retryAfterMs)) {
      error.retryAfterMs = error.details.retryAfterMs;
    }
    throw error;
  }
  return data;
}

function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getItem('xxa_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function retryDelayMs(attempt) {
  return Math.min(300 * 3 ** (attempt - 1), 3000);
}

function isRetryableError(error) {
  if (error?.code === 'TIMEOUT') return true;
  if (error?.code === 'NETWORK') return true;
  const status = error?.status;
  return status === 502 || status === 503 || status === 504;
}

// Normalize a Taro.request rejection (network down / timeout) into the same
// coded errors the web layer raises, so callers branch identically across ends.
function normalizeRequestError(error) {
  const msg = error?.errMsg || '';
  if (/timeout/i.test(msg)) {
    const e = new Error('请求超时了，请检查网络后重试。');
    e.code = 'TIMEOUT';
    return e;
  }
  if (/fail/i.test(msg)) {
    const e = new Error('网络连接失败，请稍后重试。');
    e.code = 'NETWORK';
    return e;
  }
  return error;
}

// POST JSON with per-request timeout and opt-in retry of transient failures.
export async function postJson(url, payload, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await Taro.request({
        url: API_BASE + url,
        method: 'POST',
        header: buildAuthHeaders(),
        data: payload,
        timeout: timeoutMs,
        dataType: 'json',
      });
      return parseEnvelope(res.statusCode, res.data);
    } catch (error) {
      // Envelope errors thrown by parseEnvelope already carry .status/.code.
      const surfaced = error instanceof Error && error.status ? error : normalizeRequestError(error);
      if (attempt < retries && isRetryableError(surfaced)) {
        attempt += 1;
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw surfaced;
    }
  }
}

// ---- Streaming (SSE-style) chat ----------------------------------------------
// Parse one raw SSE frame into { event, data } — shared by both transports.
function parseSseFrame(frame) {
  let event = null;
  const dataLines = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  return { event, data: dataLines.join('\n') };
}

function emitFrame(frame, onEvent) {
  const { event, data } = parseSseFrame(frame);
  if (!event) return;
  let parsed = {};
  if (data) {
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = {};
    }
  }
  onEvent?.(event, parsed);
}

// H5 transport: fetch + ReadableStream (browsers only).
async function postSseFetch(url, payload, { onEvent } = {}) {
  const response = await fetch(API_BASE + url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
    const data = await response.json().catch(() => ({}));
    return parseEnvelope(response.status, data);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        emitFrame(buffer.slice(0, sep), onEvent);
        buffer = buffer.slice(sep + 2);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  const tail = buffer.replace(/\r\n/g, '\n').trim();
  if (tail) emitFrame(tail, onEvent);
  return null;
}

// Mini-program transport: Taro.request with enableChunked + onChunkReceived.
// Chunks arrive as ArrayBuffer; decode, split on blank-line frame boundaries.
async function postSseChunked(url, payload, { onEvent } = {}) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const decodeChunk = (data) => {
      try {
        if (typeof data === 'string') return data;
        // ArrayBuffer -> utf-8 string (mini-program has no TextDecoder on old bases)
        const bytes = new Uint8Array(data);
        let out = '';
        for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
        return decodeURIComponent(escape(out));
      } catch {
        return '';
      }
    };
    const task = Taro.request({
      url: API_BASE + url,
      method: 'POST',
      header: buildAuthHeaders(),
      data: payload,
      enableChunked: true,
      success: () => {
        if (settled) return;
        settled = true;
        const tail = buffer.replace(/\r\n/g, '\n').trim();
        if (tail) emitFrame(tail, onEvent);
        resolve(null);
      },
      fail: (err) => {
        if (settled) return;
        settled = true;
        reject(normalizeRequestError(err));
      },
    });
    if (task && typeof task.onChunkReceived === 'function') {
      task.onChunkReceived((res) => {
        buffer += decodeChunk(res.data);
        buffer = buffer.replace(/\r\n/g, '\n');
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          emitFrame(buffer.slice(0, sep), onEvent);
          buffer = buffer.slice(sep + 2);
        }
      });
    }
  });
}

// Public streaming entry — picks the transport for the current build target.
export async function postSse(url, payload, options = {}) {
  if (process.env.TARO_ENV === 'h5') {
    return postSseFetch(url, payload, options);
  }
  return postSseChunked(url, payload, options);
}
