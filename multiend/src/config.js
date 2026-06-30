// Cross-end runtime config. Unlike the web build (Vite proxies /api -> :3000),
// mini-program & app builds CANNOT use a relative /api path — every request must
// carry an absolute, HTTPS, domain-whitelisted base URL. Override per build via
// the TARO_APP_API_BASE env at compile time.
const isH5 = typeof process !== 'undefined' && process.env && process.env.TARO_ENV === 'h5';

// H5 defaults to a relative base ('' → /api/...) so it stays same-origin and the
// dev server proxies /api → backend (mirroring the old Vite setup; no CORS). The
// mini-program / App build MUST use an absolute HTTPS, domain-whitelisted base —
// override it at compile time via TARO_APP_API_BASE.
export const API_BASE =
  (typeof process !== 'undefined' && process.env && process.env.TARO_APP_API_BASE) ||
  (isH5 ? '' : 'http://localhost:3000');
