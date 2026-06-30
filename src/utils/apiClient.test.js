import { describe, test, expect, vi, afterEach } from 'vitest';
import { postJson } from './apiClient.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return Promise.resolve({ ok, status, json: async () => payload });
}

// A fetch that never resolves on its own — it only rejects (with an AbortError)
// when its signal aborts, simulating a hung connection.
function hangingFetch() {
  return (_url, { signal }) => new Promise((_resolve, reject) => {
    const abort = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('postJson', () => {
  test('returns the parsed envelope on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse({ ok: true, value: 42 }));
    const data = await postJson('/api/x', {});
    expect(data.value).toBe(42);
  });

  test('a hung request times out with a TIMEOUT error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(hangingFetch());
    await expect(postJson('/api/x', {}, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  test('retries a transient 503 then succeeds when retries > 0', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ ok: false, error: { code: 'X', message: 'busy' } }, { ok: false, status: 503 });
      }
      return jsonResponse({ ok: true, value: 'recovered' });
    });
    const data = await postJson('/api/x', {}, { retries: 2 });
    expect(calls).toBe(2);
    expect(data.value).toBe('recovered');
  });

  test('does NOT retry a 400 client error', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      return jsonResponse({ ok: false, error: { code: 'BAD', message: 'nope' } }, { ok: false, status: 400 });
    });
    await expect(postJson('/api/x', {}, { retries: 3 })).rejects.toMatchObject({ status: 400, code: 'BAD' });
    expect(calls).toBe(1);
  });

  test('surfaces retryAfterMs from a 429 envelope and localizes the wait message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'slow down', details: { retryAfterMs: 5000 } } },
      { ok: false, status: 429 },
    ));
    await expect(postJson('/api/x', {})).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 5000,
      message: '操作太频繁啦，请在 5 秒后再试。',
    });
  });

  test('a caller abort propagates as an AbortError (silent cancel, not a timeout)', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(hangingFetch());
    const pending = postJson('/api/x', {}, { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
