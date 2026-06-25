import { afterEach, describe, expect, test, vi } from 'vitest';
import { downloadJson } from './download.js';

describe('downloadJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('creates a blob url, triggers an anchor download, then revokes it', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const ok = downloadJson({ hello: 'world' }, 'data.json');

    expect(ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  test('returns false (never throws) when object URLs are unavailable', () => {
    const original = URL.createObjectURL;
    // Simulate an environment without the object-URL API (SSR / old runner).
    URL.createObjectURL = undefined;
    try {
      expect(downloadJson({ a: 1 }, 'x.json')).toBe(false);
    } finally {
      URL.createObjectURL = original;
    }
  });

  test('returns false but still revokes the object URL if the download throws', () => {
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download blocked');
    });

    const ok = downloadJson({ a: 1 }, 'x.json');

    expect(ok).toBe(false);
    // The finally block must release the blob even though click() threw.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
