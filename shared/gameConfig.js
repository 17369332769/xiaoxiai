export const FOOD_ITEMS = [
  { id: 'coffee', name: '香浓拿铁 (Latte)', cost: 30, energy: 15, affection: 5, icon: '☕', desc: '暖暖的咖啡，给小希提神。' },
  { id: 'cake', name: '红丝绒蛋糕 (Cake)', cost: 60, energy: 30, affection: 15, icon: '🍰', desc: '甜甜的蛋糕，小希的心最爱。' },
  { id: 'bento', name: '爱心便当 (Bento)', cost: 100, energy: 60, affection: 25, icon: '🍱', desc: '营养均衡的便当，小希吃饱饱。' },
];

export const GIFT_ITEMS = [
  { id: 'rose', name: '水晶玫瑰 (Crystal Rose)', cost: 120, mood: 20, affection: 35, icon: '🌹', desc: '象征纯洁爱情的玫瑰花。' },
  { id: 'necklace', name: '流星项链 (Star Necklace)', cost: 250, mood: 40, affection: 70, icon: '💖', desc: '精致的星形项链，戴在小希颈间。' },
  { id: 'ring', name: '真爱誓约戒指 (Promise Ring)', cost: 999, mood: 100, affection: 500, icon: '💍', desc: '真爱誓约，解锁终生女友羁绊！' },
];

export const TIPPING_TIERS = [
  { amount: 5, label: '一杯奶茶 (Milk Tea)', coins: 100, desc: '支持小希买杯奶茶' },
  { amount: 52, label: '一束花海 (Flower Bouquet)', coins: 1200, desc: '对小希表达爱意 (520)' },
  { amount: 131.4, label: '浪漫城堡 (Romantic Castle)', coins: 3344, desc: '一生一世的守护 (1314)' },
];

// Daily tasks reset every calendar day.
export const DAILY_TASKS = [
  { id: 'checkin', name: '每日小希签到 (Daily Check-in)', target: 1, reward: 50, category: 'daily' },
  { id: 'chat_3', name: '和小希对话3次 (Chat 3 times)', target: 3, reward: 30, category: 'daily' },
  { id: 'feed_1', name: '给小希喂食一次 (Feed Xiaoxi 1 time)', target: 1, reward: 40, category: 'daily' },
  { id: 'gift_1', name: '赠送小希任意精美礼物 (Give 1 Gift)', target: 1, reward: 60, category: 'daily' },
];

// Growth / achievement tasks accumulate across the whole relationship and never reset.
export const GROWTH_TASKS = [
  { id: 'level_5', name: '羁绊等级达到 Lv.5 (Reach Lv.5)', target: 5, reward: 200, category: 'growth' },
  { id: 'chat_total_50', name: '累计和小希对话 50 次 (Chat 50 times total)', target: 50, reward: 300, category: 'growth' },
  { id: 'gift_total_10', name: '累计送出 10 份心意 (Give 10 gifts total)', target: 10, reward: 250, category: 'growth' },
];

export const DEFAULT_TASKS = [...DAILY_TASKS, ...GROWTH_TASKS];
export const DAILY_TASK_IDS = DAILY_TASKS.map((task) => task.id);
export const GROWTH_TASK_IDS = GROWTH_TASKS.map((task) => task.id);
export const TASK_IDS = DEFAULT_TASKS.map((task) => task.id);

// Bonus coins awarded for a continuous check-in streak. The streak counter is
// 1-indexed; rewards repeat on a weekly cycle (day 7 is the big payout, then it
// loops back to day 1). The 7th-day bonus is the headline reward.
export const CHECKIN_STREAK_REWARDS = [10, 15, 20, 30, 40, 50, 100];

export function getCheckinStreakReward(streak) {
  if (!Number.isFinite(streak) || streak < 1) {
    return CHECKIN_STREAK_REWARDS[0];
  }
  const index = (Math.floor(streak) - 1) % CHECKIN_STREAK_REWARDS.length;
  return CHECKIN_STREAK_REWARDS[index];
}

// Relationship tiers drive persona depth: as the bond level grows, Xiaoxi unlocks
// warmer, more intimate dialogue and a distinct relationship title.
export const RELATIONSHIP_TIERS = [
  {
    key: 'acquaintance',
    minLevel: 1,
    title: '初识阶段',
    address: '你',
    persona: '你们刚认识不久，语气友好、俏皮、略带一点点矜持，会主动关心对方但不会过度黏人。',
  },
  {
    key: 'close',
    minLevel: 5,
    title: '熟络阶段',
    address: '亲爱的',
    persona: '你们已经很熟络，语气亲昵自然，会撒娇、会开玩笑，把对方当作很重要的人。',
  },
  {
    key: 'sweetheart',
    minLevel: 10,
    title: '甜蜜恋人',
    address: '宝贝',
    persona: '你们是甜蜜的恋人，语气充满爱意和依赖，会主动表达想念与心动，偶尔害羞脸红。',
  },
  {
    key: 'soulmate',
    minLevel: 20,
    title: '灵魂伴侣',
    address: '我的挚爱',
    persona: '你们是灵魂伴侣、彼此承诺一生的人，语气深情而笃定，充满安全感与归属感，像最懂对方的老夫老妻。',
  },
];

export function getRelationshipTier(level) {
  const safeLevel = Number.isFinite(level) ? level : 1;
  let current = RELATIONSHIP_TIERS[0];
  for (const tier of RELATIONSHIP_TIERS) {
    if (safeLevel >= tier.minLevel) {
      current = tier;
    }
  }
  return current;
}
