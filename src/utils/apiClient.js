export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

export async function parseApiResponse(response) {
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    const message = data?.error?.message || '请求失败，请稍后重试。';
    const code = data?.error?.code || 'UNKNOWN_ERROR';
    const error = new Error(message);
    error.code = code;
    error.status = response.status;
    error.details = data?.error?.details || null;
    if (error.details && Number.isFinite(error.details.retryAfterMs)) {
      error.retryAfterMs = error.details.retryAfterMs;
    }
    // Localized throttle copy with a concrete wait, so the UI shows
    // "请在 N 秒后再试" instead of the server's generic English text.
    if (code === 'RATE_LIMITED' && Number.isFinite(error.retryAfterMs)) {
      const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
      error.message = `操作太频繁啦，请在 ${seconds} 秒后再试。`;
    }
    throw error;
  }

  return data;
}

// Default per-request timeout. A hung connection aborts and surfaces a real
// TIMEOUT error instead of spinning forever.
export const DEFAULT_TIMEOUT_MS = 20000;

// Bind the fetch to an abort signal that fires when EITHER the caller's signal
// aborts or our own timeout elapses. `isTimeout()` distinguishes the two so a
// timeout becomes a surfaced error while a caller abort stays a silent cancel.
function createTimeoutSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = timeoutMs > 0
    ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
    : null;
  return {
    signal: controller.signal,
    isTimeout: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
}

// Only transient failures are safe to retry: our own timeout, a network-layer
// fetch rejection (TypeError), or a transient upstream 5xx. A 4xx / business
// error is deterministic and must not be retried.
function isRetryableError(error) {
  if (error?.code === 'TIMEOUT') return true;
  if (error?.name === 'TypeError') return true;
  const status = error?.status;
  return status === 502 || status === 503 || status === 504;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff: 300ms, 900ms, 2700ms (capped). No jitter, for test determinism.
function retryDelayMs(attempt) {
  return Math.min(300 * (3 ** (attempt - 1)), 3000);
}

function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };

  // Attach the account auth token when present so the backend can resolve the
  // request to the authenticated (bound) user instead of trusting body.userId.
  let token = null;
  try {
    token = localStorage.getItem('xxa_token');
  } catch {
    // localStorage may be unavailable (SSR / privacy mode); fall back to guest.
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

// POST a JSON payload. Adds a per-request timeout (default 20s) and, when
// `retries > 0`, transparently retries transient failures (timeout / network /
// 5xx) with exponential backoff. Retries are OPT-IN per call so only safe or
// idempotent endpoints (reads, or writes carrying a server-side idempotency key)
// enable them — a blind retry of a non-idempotent write could double-apply.
export async function postJson(url, payload, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0 } = {}) {
  let attempt = 0;
  for (;;) {
    const timeout = createTimeoutSignal(signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(),
        signal: timeout.signal,
        body: JSON.stringify(payload),
      });
      return await parseApiResponse(response);
    } catch (error) {
      let surfaced = error;
      if (timeout.isTimeout() && isAbortError(error)) {
        // Our timeout fired — turn the silent AbortError into a real, shown error.
        surfaced = new Error('请求超时了，请检查网络后重试。');
        surfaced.code = 'TIMEOUT';
      } else if (isAbortError(error)) {
        // The caller aborted (navigation / userId switch) — propagate silently.
        throw error;
      }
      if (attempt < retries && isRetryableError(surfaced)) {
        attempt += 1;
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw surfaced;
    } finally {
      timeout.cleanup();
    }
  }
}

// Parse one raw SSE frame (lines between blank-line separators) into its
// `event:` name and concatenated `data:` payload. Lines that are neither are
// ignored (comments / unknown fields), matching the SSE spec loosely.
function parseSseFrame(frame) {
  let event = null;
  const dataLines = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return { event, data: dataLines.join('\n') };
}

// Streaming counterpart of postJson for Server-Sent Events. POSTs the payload
// (with the same auth header) and invokes onEvent(eventName, parsedData) for
// every frame as it arrives. Pre-stream failures (auth, content blocked, user
// not found) come back as the normal JSON error envelope rather than a stream,
// so we hand those to parseApiResponse and let it throw exactly like postJson.
// onEvent is allowed to throw (e.g. on a server-sent `error` frame); the throw
// propagates out after the reader is cancelled.
export async function postSse(url, payload, { signal, onEvent } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    signal,
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
    // Not a live stream — either an error envelope or an unexpected non-stream
    // body. parseApiResponse throws on the error envelope; otherwise returns the
    // decoded JSON so the caller can still finalize from a one-shot response.
    return parseApiResponse(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF so frame + line splitting stay endings-agnostic: the SSE
      // spec permits `\r\n`, and a proxy or a future backend may emit it even
      // though ours currently uses `\n`. Without this a `\r\n\r\n` boundary
      // never matches the `\n\n` split and the whole stream would silently stall.
      buffer = buffer.replace(/\r\n/g, '\n');

      // Frames are delimited by a blank line. JSON.stringify never emits a raw
      // newline, so a single `\n\n` split cleanly separates whole frames.
      let sepIndex;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const { event, data } = parseSseFrame(frame);
        if (!event) continue;
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
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader already closed / errored — nothing to clean up.
    }
  }

  // Defensive flush: our backend always terminates frames (incl. the final
  // `done`) with a blank line, but a non-conforming server might omit the last
  // delimiter. Parse any leftover so the final frame isn't silently dropped.
  const tail = buffer.replace(/\r\n/g, '\n').trim();
  if (tail) {
    const { event, data } = parseSseFrame(tail);
    if (event) {
      let parsed = {};
      if (data) {
        try { parsed = JSON.parse(data); } catch { parsed = {}; }
      }
      onEvent?.(event, parsed);
    }
  }

  return null;
}
