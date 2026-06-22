// Shared mapping from the long-term memory keys (English snake_case, produced by
// the memory-consolidation model or the local rule engine) to human-friendly
// Chinese labels shown in the UI. Used by both the backend (API + timeline) and
// the frontend memory card so the same key never renders as raw English.

export const MEMORY_LABELS = {
  // Controlled vocabulary the consolidation prompt is asked to stick to.
  favorite_drink: '常喝饮品',
  favorite_food: '偏爱食物',
  food_preference: '口味偏好',
  hobby: '兴趣爱好',
  job: '职业身份',
  study_goal: '近期目标',
  stress_signal: '最近状态',
  mood_trigger: '情绪触发点',
  relationship_dynamic: '关系氛围',
  recent_conflict: '最近的小摩擦',
  hidden_wish: '小小心愿',
  birthday: '生日',
  anniversary: '纪念日',
  test_date: '考试日期',
  pet: '宠物',
  location: '所在城市',
  nickname: '专属称呼',
  sleep_habit: '作息习惯',
  health: '身体状况',
  family: '重要的人',
};

// Substring heuristics for keys outside the controlled vocabulary (legacy rows
// or new keys the model still invents). First match wins, so order from most to
// least specific.
const KEYWORD_LABELS = [
  [/drink|beverage|tea|coffee|milk_?tea/, '饮品'],
  [/food|eat|meal|snack|dish|cook|cuisine|hungry/, '饮食'],
  [/wish|want|desire|hope|dream|crave/, '小小心愿'],
  [/gift|present/, '心意礼物'],
  [/comfort|soothe|cuddle|hug/, '安慰方式'],
  [/song|music|sing|melody/, '共同的歌'],
  [/memory|moment|remember|nostalg|reminisce/, '共同回忆'],
  [/interaction|together|companion|accompany|share/, '相处点滴'],
  [/alcohol|wine|beer|drunk|incident/, '生活点滴'],
  [/conflict|quarrel|fight|argue|apolog/, '最近的小摩擦'],
  [/relationship|bond|intimacy|affection|romance|couple/, '关系氛围'],
  [/mood|stress|emotion|feel|tired|anxious/, '心情状态'],
  [/goal|plan|target|ambition/, '近期目标'],
  [/exam|test|study|school|homework|class/, '学业'],
  [/job|work|career|office|salary/, '工作'],
  [/birthday|anniversary|date|festival|holiday/, '重要日子'],
  [/name|nickname|call|title/, '称呼'],
  [/family|parent|mother|father|friend|sibling/, '重要的人'],
  [/pet|cat|dog/, '宠物'],
  [/health|sick|body|sleep|rest/, '身体与作息'],
  [/habit|routine|daily/, '生活习惯'],
  [/location|city|home|address|place|live/, '所在地'],
  [/hobby|interest|like|favorite|prefer/, '喜好'],
];

// Returns a Chinese label for a memory key, falling back to keyword heuristics
// and finally a neutral label so the UI never shows raw English snake_case.
export function humanizeMemoryKey(key) {
  if (!key || typeof key !== 'string') {
    return '小秘密';
  }

  const normalized = key.trim().toLowerCase();
  if (MEMORY_LABELS[normalized]) {
    return MEMORY_LABELS[normalized];
  }

  for (const [pattern, label] of KEYWORD_LABELS) {
    if (pattern.test(normalized)) {
      return label;
    }
  }

  return '其他小事';
}
