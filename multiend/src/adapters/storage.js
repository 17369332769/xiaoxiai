// Cross-end storage adapter — replaces direct `localStorage` usage so the same
// code runs on H5, every mini-program, and React Native. Taro.*StorageSync is
// available on all three; the web's `localStorage` is not (mini-program/RN have
// no `window`). Keep the localStorage-shaped API (getItem/setItem/removeItem) so
// porting call sites is a near-mechanical swap.
import Taro from '@tarojs/taro';

// localStorage.getItem returns `null` when absent; Taro.getStorageSync returns
// `''`. Normalize to `null` so existing `=== null` / falsy checks behave.
export function getItem(key) {
  try {
    const value = Taro.getStorageSync(key);
    return value === '' || value === undefined ? null : value;
  } catch {
    return null;
  }
}

export function setItem(key, value) {
  try {
    Taro.setStorageSync(key, value);
  } catch {
    // Storage may be full / unavailable (private mode) — degrade silently,
    // matching the web call sites that already wrap localStorage in try/catch.
  }
}

export function removeItem(key) {
  try {
    Taro.removeStorageSync(key);
  } catch {
    /* ignore */
  }
}
