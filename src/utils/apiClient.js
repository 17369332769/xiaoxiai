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
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(payload),
  });

  return parseApiResponse(response);
}
