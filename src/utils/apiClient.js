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
    throw error;
  }

  return data;
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

export async function postJson(url, payload, { signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    signal,
    body: JSON.stringify(payload),
  });

  return parseApiResponse(response);
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

  return null;
}
