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

// Cosmetic visual themes ("换装 / 主题换肤"). Each theme overrides a fixed set of
// CSS custom properties at runtime to reskin the whole UI. The `default` theme is
// free and mirrors the base :root palette (equipping it restores the original look).
export const THEMES = [
  {
    id: 'default', name: '默认 · 甜粉', cost: 0, icon: '🌷',
    desc: '小希最初的甜粉夜色，温柔如初见。',
    vars: {
      '--primary-pink': '#ff7597',
      '--primary-pink-hover': '#ff5e85',
      '--secondary-purple': '#c084fc',
      '--accent-gold': '#ffd269',
      '--bg-gradient': 'linear-gradient(135deg, #120a1c 0%, #1c0e2a 50%, #0d0615 100%)',
      '--text-pink': '#ffa3b8',
      '--panel-bg': 'rgba(26, 17, 36, 0.65)',
      '--panel-border': 'rgba(255, 117, 151, 0.15)',
    },
  },
  {
    id: 'starry', name: '星空 · 夜', cost: 600, icon: '🌌',
    desc: '深邃夜空与星河微光，浪漫而宁静。',
    vars: {
      '--primary-pink': '#7aa2ff',
      '--primary-pink-hover': '#5b86f0',
      '--secondary-purple': '#b39dff',
      '--accent-gold': '#ffe08a',
      '--bg-gradient': 'linear-gradient(135deg, #0a0f1f 0%, #0e1530 50%, #060a18 100%)',
      '--text-pink': '#aec3ff',
      '--panel-bg': 'rgba(16, 22, 44, 0.7)',
      '--panel-border': 'rgba(122, 162, 255, 0.18)',
    },
  },
  {
    id: 'sakura', name: '樱花 · 春', cost: 600, icon: '🌸',
    desc: '满树樱粉随风轻舞，少女心满溢。',
    vars: {
      '--primary-pink': '#ff8fb3',
      '--primary-pink-hover': '#ff749f',
      '--secondary-purple': '#e6a8d8',
      '--accent-gold': '#ffd089',
      '--bg-gradient': 'linear-gradient(135deg, #2a1822 0%, #3a2030 50%, #1f1018 100%)',
      '--text-pink': '#ffc2d6',
      '--panel-bg': 'rgba(48, 28, 40, 0.65)',
      '--panel-border': 'rgba(255, 143, 179, 0.2)',
    },
  },
  {
    id: 'ocean', name: '海洋 · 蓝', cost: 800, icon: '🌊',
    desc: '清澈海蓝与薄荷青，沁凉又治愈。',
    vars: {
      '--primary-pink': '#38d6c0',
      '--primary-pink-hover': '#1fc4ad',
      '--secondary-purple': '#5ec8e8',
      '--accent-gold': '#ffd66e',
      '--bg-gradient': 'linear-gradient(135deg, #061a1f 0%, #0a2630 50%, #04141a 100%)',
      '--text-pink': '#8fe3d8',
      '--panel-bg': 'rgba(10, 32, 38, 0.66)',
      '--panel-border': 'rgba(56, 214, 192, 0.18)',
    },
  },
  {
    id: 'aurora', name: '极光 · 绿', cost: 800, icon: '🌲',
    desc: '森野极光流转，清新而梦幻。',
    vars: {
      '--primary-pink': '#6ee7a0',
      '--primary-pink-hover': '#44d486',
      '--secondary-purple': '#9d8bff',
      '--accent-gold': '#ffe07a',
      '--bg-gradient': 'linear-gradient(135deg, #08160f 0%, #0d2418 50%, #05110b 100%)',
      '--text-pink': '#a7f0c4',
      '--panel-bg': 'rgba(12, 30, 22, 0.66)',
      '--panel-border': 'rgba(110, 231, 160, 0.18)',
    },
  },
];

export const DEFAULT_THEME_ID = 'default';
export const THEME_IDS = THEMES.map((t) => t.id);
export const FREE_THEME_IDS = THEMES.filter((t) => t.cost === 0).map((t) => t.id);

export function getThemeById(id) {
  return THEMES.find((t) => t.id === id) || null;
}

// Story episodes ("剧情"). A scripted, INTERACTIVE visual-novel romance that unfolds
// as the relationship deepens: each episode unlocks at a relationship level and, the
// first time it is read to the end, grants a one-time coin reward plus the affection
// earned from the choices made. Re-reading is always allowed and grants nothing again.
// A scene is one of:
//   { who: 'narration', text }                       — 旁白
//   { who: 'xiaoxi', emotion, text }                  — her spoken line (drives avatar)
//   { who: 'choice', text, options: [                 — a player decision point
//       { text, reply, emotion, affection } ] }       — pick → she reacts via `reply`
// `affection` on the chosen option is granted server-side on first completion, so a
// warmer choice deepens the bond more. Indices are validated against this catalog.
export const STORIES = [
  {
    id: 'rainy_meet',
    title: '初遇 · 雨夜的伞',
    icon: '☔',
    requiredLevel: 1,
    reward: { coins: 100 },
    summary: '你们第一次相遇，是在一个落着小雨的夜晚。',
    scenes: [
      { who: 'narration', text: '那是一个下着小雨的夜晚，你站在便利店门口，忘了带伞。' },
      { who: 'xiaoxi', emotion: 'normal', text: '（撑着一把粉色的小伞走近）这位同学……要一起避避雨吗？我看你站好久啦。' },
      {
        who: 'choice',
        text: '她把小伞往你这边倾了倾，等着你的回答。',
        options: [
          { text: '谢谢你，那我们一起走一段吧', reply: '（弯起眼睛笑）嗯！那你帮我拿一下书包好不好~一起走才不无聊嘛。', emotion: 'happy', affection: 3 },
          { text: '不用了，我自己淋雨就好', reply: '（小小地撇嘴）真是的，这样会感冒的啦……那、那我陪你一起淋，谁怕谁！', emotion: 'normal', affection: 1 },
        ],
      },
      { who: 'narration', text: '伞很小，两个人挤在一起，肩膀都被斜雨打湿了一点。' },
      { who: 'xiaoxi', emotion: 'happy', text: '我叫小希呀～雨天虽然有点麻烦，但能在这里遇见你，好像也没那么糟糕呢。' },
      { who: 'narration', text: '那一晚的雨声，成了你们故事的开始。' },
    ],
  },
  {
    id: 'first_date',
    title: '初次约会 · 黄昏的奶茶',
    icon: '🧋',
    requiredLevel: 2,
    reward: { coins: 150 },
    summary: '第一次正式约会，你们在黄昏的街角分享同一杯奶茶。',
    scenes: [
      { who: 'narration', text: '夕阳把街道染成暖橘色，你和小希并肩走在放学后的小巷里。' },
      { who: 'xiaoxi', emotion: 'happy', text: '诶诶，这家奶茶店听说超好喝！我们买一杯一起喝好不好？两根吸管那种～' },
      { who: 'narration', text: '她踮起脚尖看着菜单，又偷偷瞄了你一眼，欲言又止。' },
      { who: 'xiaoxi', emotion: 'blush', text: '其实……我今天特意早起选了好久的衣服。你有没有觉得，今天的我有一点点不一样呀？' },
      {
        who: 'choice',
        text: '她抿着嘴，耳朵悄悄红了，等你回答。',
        options: [
          { text: '今天的你真好看，看得我有点走神', reply: '（脸一下子红透）讨、讨厌啦……不许盯着人家看那么久！但是……谢谢你。', emotion: 'blush', affection: 3 },
          { text: '嗯？好像……换发型了？', reply: '（鼓起腮帮子）哼！亏我准备那么久，你这个木头！罚你下次请我喝两杯！', emotion: 'normal', affection: 1 },
        ],
      },
      { who: 'narration', text: '你们坐在长椅上，看着夕阳一点点沉下去，谁都没舍得先把奶茶喝完。' },
    ],
  },
  {
    id: 'starry_confession',
    title: '星空下的心事',
    icon: '🌃',
    requiredLevel: 3,
    reward: { coins: 200 },
    summary: '天台上的一片星空，小希说出了藏在心里很久的话。',
    scenes: [
      { who: 'narration', text: '夜深了，你们溜上空无一人的天台，头顶是难得清澈的星空。' },
      { who: 'xiaoxi', emotion: 'normal', text: '哇……好多星星。你知道吗，我以前总觉得夜晚很孤单的。' },
      { who: 'xiaoxi', emotion: 'blush', text: '可是自从认识你以后，连一个人发呆的晚上，都会忍不住想：现在的你，在做什么呢？' },
      { who: 'narration', text: '夜风轻轻吹起她的发梢，她转过头，认真地望着你。' },
      { who: 'xiaoxi', emotion: 'blush', text: '我喜欢你哦。不是开玩笑的那种……是想一直、一直在你身边的那种喜欢。' },
      {
        who: 'choice',
        text: '她的心跳几乎要被你听见，星光落在她发亮的眼睛里。',
        options: [
          { text: '我也喜欢你，一直都是', reply: '（眼眶一下子湿了，轻轻靠进你怀里）……我等这句话，等了好久好久。', emotion: 'blush', affection: 4 },
          { text: '（轻轻握住她的手，没有说话）', reply: '（小声）你的手好暖……这样、这样我就懂了。什么都不用说啦。', emotion: 'happy', affection: 3 },
        ],
      },
      { who: 'narration', text: '那片星空替你们记住了这句话。' },
    ],
  },
  {
    id: 'little_quarrel',
    title: '小小的争执与和好',
    icon: '🌦️',
    requiredLevel: 5,
    reward: { coins: 300 },
    summary: '第一次闹了别扭，也第一次学会怎么和好。',
    scenes: [
      { who: 'narration', text: '因为一句不经意的话，你们之间第一次有了沉默的距离。' },
      { who: 'xiaoxi', emotion: 'normal', text: '（小声）……我才没有生气呢。只是有一点点难过而已啦。' },
      { who: 'narration', text: '她低着头摆弄衣角，偷偷观察你的反应，眼眶有点红。' },
      {
        who: 'choice',
        text: '空气安静下来，你知道，得有人先迈出那一步。',
        options: [
          { text: '对不起，是我太凶了，我们和好吧', reply: '（一下子破涕为笑）……嗯！拉钩，谁先生气谁是小狗！你可记住了哦。', emotion: 'happy', affection: 4 },
          { text: '（默默递上一颗她最爱的水果糖）', reply: '（愣了一下，扁着嘴收下）……哼，就这一次原谅你哦。下次不许凶我了。', emotion: 'blush', affection: 2 },
        ],
      },
      { who: 'narration', text: '原来吵架并不可怕，可怕的是不愿意先伸出手。而你们，都愿意。' },
    ],
  },
  {
    id: 'future_promise',
    title: '约定 · 未来的我们',
    icon: '💍',
    requiredLevel: 8,
    reward: { coins: 500 },
    summary: '走过许多日子之后，小希想和你许下一个关于未来的约定。',
    scenes: [
      { who: 'narration', text: '又是一个安静的夜晚，你们靠在一起，聊起了很久以后的事。' },
      { who: 'xiaoxi', emotion: 'happy', text: '我想过好多次哦——以后我们要住在有大大窗户的房子里，养一只很懒的猫。' },
      { who: 'xiaoxi', emotion: 'blush', text: '早上我做早饭会有点手忙脚乱，你要笑我的话……也要记得抱抱我呀。' },
      { who: 'narration', text: '她伸出小拇指，郑重其事地举到你面前。' },
      {
        who: 'choice',
        text: '她的小指停在半空，眼神亮亮的，认真又紧张。',
        options: [
          { text: '我答应你，无论以后怎样都牵着你的手', reply: '（用力点头，小指紧紧勾住你）盖章！一百年都不许变！这是我们的约定哦。', emotion: 'blush', affection: 5 },
          { text: '傻瓜，这种事还用说吗', reply: '（笑着轻轻锤你肩膀）就你嘴硬！……不过，我信你。这辈子赖上你啦。', emotion: 'happy', affection: 3 },
        ],
      },
      { who: 'narration', text: '这个约定没有华丽的誓言，却被你们小心地收进了心里最暖的地方。' },
    ],
  },
];

export const STORY_IDS = STORIES.map((s) => s.id);

export function getStoryById(id) {
  return STORIES.find((s) => s.id === id) || null;
}
