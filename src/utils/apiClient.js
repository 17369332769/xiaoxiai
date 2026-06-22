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

export async function postJson(url, payload, { signal } = {}) {
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

  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(payload),
  });

  return parseApiResponse(response);
}
