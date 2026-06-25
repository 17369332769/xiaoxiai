// Browser-only helper: serialize `data` to pretty JSON and trigger a client-side
// file download. Returns false (a no-op) in environments without the Blob / URL
// object-URL APIs (SSR, older test runners) so callers can stay agnostic and
// never throw on a missing download capability.
export function downloadJson(data, filename) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  let url = null;
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  } catch {
    // A browser quirk (blocked download, detached document) must not crash the
    // caller — report failure so it can surface a friendly message instead.
    return false;
  } finally {
    // Always release the object URL — even if click()/removeChild threw — so a
    // failed download can't leak the blob for the lifetime of the page.
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  }
}
