// Lightweight content-safety filter for user chat input.
//
// This is a starter, demo-grade keyword filter — NOT a replacement for a real
// moderation service. The built-in list is intentionally small and coarse;
// operators extend it at runtime via the EXTRA_BLOCKED_WORDS env var
// (comma-separated) without code changes.

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
