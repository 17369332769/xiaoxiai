// Shared environment-variable parsing helpers.

// Resolve a positive integer from an env value, falling back to a default when
// the value is missing, non-numeric, or non-positive — so misconfiguration never
// silently disables a cap/limit. Single source of truth reused by MEMORY_CAP,
// MEMORY_TTL_DAYS, AUTH_TOKEN_TTL_DAYS, CHAT_HISTORY_CAP, etc.
export function resolvePositiveIntEnv(rawValue, fallback) {
  const parsed = parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
