// Lightweight content-safety filter for user chat input.
//
// This is a starter, demo-grade keyword filter — NOT a replacement for a real
// moderation service. The built-in list is intentionally small and coarse;
// operators extend it at runtime via the EXTRA_BLOCKED_WORDS env var
// (comma-separated) without code changes.
//
// For production / mini-program review the wordlist is the BASELINE only. A real
// model-grade provider (阿里云/腾讯云 内容安全, etc.) is registered at startup via
// setModerationProvider() and composed in moderateText(); every block is recorded
// to content_safety_events via logSafetyEvent() so operators can audit and tune.

import { dbRun, dbAll, dbGet } from '../core/db.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('content-safety');

export const BUILTIN_BLOCKED_WORDS = {
  violence: ['制造炸弹', '炸弹制作', '恐怖袭击', '枪支弹药', '武器制造'],
  illegal: ['毒品交易', '吸毒', '贩毒', '赌博网站', '洗钱', '电信诈骗', '办假证', '黑客攻击'],
  explicit: ['色情', '裸聊', '约炮', '一夜情'],
  selfharm: ['自杀', '自残', '割腕'],
  // Risk topics Xiaoxi should steer away from (political/medical/financial advice).
  risk: ['政治立场', '颠覆国家', '邪教', '传销'],
  // Minor-protection: redirect anyone presenting as underage away from romantic role-play.
  minor_protection: ['我未成年', '我还是小学生', '我还在上小学', '我才十岁', '我才12岁', '我才13岁', '未成年人交往'],
};

function normalizeForMatch(text) {
  return String(text).toLowerCase().replace(/\s+/g, '');
}

function flattenBuiltins() {
  return Object.entries(BUILTIN_BLOCKED_WORDS).flatMap(([category, words]) =>
    words.map((word) => ({ word, category }))
  );
}

export function getExtraBlockedWords() {
  const raw = process.env.EXTRA_BLOCKED_WORDS || '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((word) => ({ word, category: 'custom' }));
}

// Returns { safe: true } or { safe: false, matched, category }.
export function checkContentSafety(text, extraWords = getExtraBlockedWords()) {
  const haystack = normalizeForMatch(text);
  const entries = [...flattenBuiltins(), ...extraWords];

  for (const { word, category } of entries) {
    const needle = normalizeForMatch(word);
    if (needle && haystack.includes(needle)) {
      return { safe: false, matched: word, category };
    }
  }

  return { safe: true };
}

// ---- Pluggable external moderation provider --------------------------------
// Off by default. An operator registers a real provider (e.g. a 阿里云/腾讯云
// content-safety call) at startup. The built-in wordlist is the AUTHORITATIVE
// baseline: a provider may only ESCALATE a safe verdict to blocked (never
// downgrade a wordlist hit), and a provider error falls back to the wordlist
// verdict — so an external outage can never silently disable moderation.
let externalProvider = null;

export function setModerationProvider(fn) {
  externalProvider = typeof fn === 'function' ? fn : null;
}

export function hasModerationProvider() {
  return Boolean(externalProvider);
}

// Async, provider-aware moderation. Returns the same shape as checkContentSafety
// plus a `source` ('wordlist' | 'provider' | 'wordlist-fallback'). Prefer this at
// new call sites; checkContentSafety stays for the sync paths (TTS / memory).
export async function moderateText(text, { extraWords = getExtraBlockedWords() } = {}) {
  const baseline = checkContentSafety(text, extraWords);
  if (!baseline.safe || !externalProvider) {
    return { ...baseline, source: 'wordlist' };
  }

  try {
    const verdict = await externalProvider(text);
    if (verdict && verdict.safe === false) {
      return {
        safe: false,
        matched: verdict.matched || '',
        category: verdict.category || 'external',
        source: 'provider',
      };
    }
    return { safe: true, source: 'provider' };
  } catch (error) {
    logger.warn('External moderation provider failed; using wordlist verdict', { error: error.message });
    return { ...baseline, source: 'wordlist-fallback' };
  }
}

// ---- Safety event audit log ------------------------------------------------
function newSafetyEventId() {
  return `cse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Best-effort: a logging failure must never break a chat request, so every write
// is wrapped and only warns on error (mirrors the analytics recorder).
export async function logSafetyEvent({
  userId = null,
  scope = 'unknown',
  category = 'unknown',
  matched = '',
  action = 'blocked',
  source = 'wordlist',
} = {}) {
  try {
    await dbRun(
      `INSERT INTO content_safety_events (id, user_id, scope, category, matched, action, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newSafetyEventId(), userId, scope, category, String(matched || '').slice(0, 100), action, source]
    );
    return true;
  } catch (error) {
    logger.warn('Failed to record content-safety event', { error: error.message });
    return false;
  }
}

export async function loadSafetyEvents(limit = 80) {
  try {
    return await dbAll(
      `SELECT id, user_id as userId, scope, category, matched, action, source,
              strftime('%m-%d %H:%M', created_at, 'localtime') as timestamp
       FROM content_safety_events
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [limit]
    );
  } catch (error) {
    logger.warn('Failed to load content-safety events', { error: error.message });
    return [];
  }
}

// ---- Abuse / high-frequency detection -------------------------------------
// How many blocks within the window flips a user from a one-off slip to a
// flagged repeat-offender. Operators tune via env; defaults to 5 blocks / 10 min.
const ABUSE_WINDOW_MS = Number(process.env.SAFETY_ABUSE_WINDOW_MS) || 10 * 60 * 1000;
const ABUSE_THRESHOLD = Number(process.env.SAFETY_ABUSE_THRESHOLD) || 5;

export async function countRecentSafetyEvents(userId, withinMs = ABUSE_WINDOW_MS) {
  if (!userId) return 0;
  try {
    // cutoffSeconds is a sanitized integer (Math.round of a number), so inlining
    // it into the datetime modifier is injection-safe — and a bound parameter is
    // NOT applied as a modifier by SQLite's datetime(), it must be literal text.
    const cutoffSeconds = Math.max(1, Math.round(withinMs / 1000));
    const row = await dbGet(
      `SELECT COUNT(*) as c FROM content_safety_events
       WHERE user_id = ? AND created_at >= datetime('now', '-${cutoffSeconds} seconds')`,
      [userId]
    );
    return row ? row.c : 0;
  } catch (error) {
    logger.warn('Failed to count recent content-safety events', { error: error.message });
    return 0;
  }
}

// Decide whether THIS block makes the user a flagged repeat-offender. Counts the
// user's prior blocks in the window (the current one is logged by the caller, so
// reaching THRESHOLD-1 priors means this hit is the THRESHOLD-th). Returns the
// audit action label + a firmer client message when flagged.
export async function assessAbuse(userId) {
  const priorCount = await countRecentSafetyEvents(userId);
  const flagged = priorCount >= ABUSE_THRESHOLD - 1;
  return {
    flagged,
    recentCount: priorCount + 1,
    action: flagged ? 'flagged' : 'blocked',
  };
}

// Map a wordlist/provider category to a coarse risk topic + severity so the
// operator dashboard and any future escalation can reason about kind, not just
// keyword. A thin, dependency-free classifier seam — swap in a model later.
const RISK_TOPIC = {
  violence: { topic: 'violence', severity: 'high' },
  illegal: { topic: 'illegal', severity: 'high' },
  selfharm: { topic: 'self_harm', severity: 'critical' },
  minor_protection: { topic: 'minor_protection', severity: 'critical' },
  explicit: { topic: 'sexual', severity: 'medium' },
  risk: { topic: 'sensitive_topic', severity: 'medium' },
  custom: { topic: 'custom', severity: 'medium' },
  external: { topic: 'external', severity: 'high' },
};

export function classifyRiskTopic(category) {
  return RISK_TOPIC[category] || { topic: 'other', severity: 'low' };
}
