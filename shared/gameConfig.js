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

export const DEFAULT_TASKS = [
  { id: 'checkin', name: '每日小希签到 (Daily Check-in)', target: 1, reward: 50 },
  { id: 'chat_3', name: '和小希对话3次 (Chat 3 times)', target: 3, reward: 30 },
  { id: 'feed_1', name: '给小希喂食一次 (Feed Xiaoxi 1 time)', target: 1, reward: 40 },
  { id: 'gift_1', name: '赠送小希任意精美礼物 (Give 1 Gift)', target: 1, reward: 60 },
];

export const TASK_IDS = DEFAULT_TASKS.map((task) => task.id);
