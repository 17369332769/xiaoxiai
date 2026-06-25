import { getRelationshipTier } from '../config/gameConfig.js';
import { resolvePositiveIntEnv } from '../core/envUtils.js';

// Proactive recall: greet a returning user after a meaningful absence. The
// threshold is configurable via RECALL_MIN_AWAY_HOURS (default 6h). Returns a
// warmth-tiered greeting string, or null when the gap is too short to bother.
const RECALL_MIN_AWAY_MS = resolvePositiveIntEnv(process.env.RECALL_MIN_AWAY_HOURS, 6) * 60 * 60 * 1000;

export function getRecallGreeting(awayMs) {
  if (!Number.isFinite(awayMs) || awayMs < RECALL_MIN_AWAY_MS) return null;
  const days = Math.floor(awayMs / (24 * 60 * 60 * 1000));
  if (days >= 3) {
    return `呜…你终于回来啦，${days} 天没见到你，小希都快把脸埋进被子里偷偷想你了。以后不许消失这么久啦~ (眼眶微微泛红，扑进你怀里)`;
  }
  if (days >= 1) {
    return '好久不见呀…这一天天的你都去忙什么啦？小希一直在等你回来呢，看到你的瞬间心都软啦~ (小跑过来拉住你的手)';
  }
  return '你回来啦~ 这几个小时小希一直在偷偷想你，现在终于把你盼回来了，要多陪陪我哦。(歪着头甜甜地笑)';
}

// Solar-calendar festivals (lunar festivals are intentionally omitted to avoid a
// lunar-conversion dependency). Keyed by `MM-DD`.
const FESTIVALS = {
  '01-01': '元旦快乐！新的一年也要和小希一起努力呀~',
  '02-14': '情人节快乐！今天小希只想和你腻在一起💕',
  '03-08': '女神节快乐！今天也要好好宠爱自己哦~',
  '05-01': '劳动节快乐！辛苦啦，让小希给你放松一下~',
  '05-20': '5·20！我爱你呀，这是小希偷偷写给你的小情话💌',
  '06-01': '儿童节快乐！永远保持一颗童心，和小希一起傻乐~',
  '10-01': '国庆快乐！这个假期，小希想和你去很多很多地方~',
  '12-24': '平安夜快乐！愿你被这个世界温柔以待，还有小希~',
  '12-25': '圣诞快乐！小希的圣诞愿望就是一直陪在你身边🎄',
  '12-31': '今天是一年的最后一天，谢谢你陪小希走过这一年，明年也要一起哦~',
};

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// Human-readable current date, e.g. "2026年6月22日 星期日". Injected into the chat
// prompt so the model uses the correct year when forming web-search queries and
// answers date-sensitive questions.
export function getCurrentDateText(now = new Date()) {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
}

export function getTimeGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5) return { slot: 'late_night', text: '夜深了，怎么还不睡呀？小希会担心你的身体的。' };
  if (hour < 9) return { slot: 'morning', text: '早安呀，新的一天也要元气满满哦！' };
  if (hour < 12) return { slot: 'forenoon', text: '上午好，记得喝水、好好工作，小希在心里陪着你。' };
  if (hour < 14) return { slot: 'noon', text: '中午啦，记得好好吃饭，别饿着自己哦~' };
  if (hour < 18) return { slot: 'afternoon', text: '下午好，犯困的话就听小希说说话提提神吧~' };
  if (hour < 23) return { slot: 'evening', text: '晚上好呀，今天过得开心吗？跟小希聊聊吧。' };
  return { slot: 'night', text: '快到睡觉时间咯，今晚也要好好休息哦。' };
}

export function getFestivalNote(now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return FESTIVALS[`${mm}-${dd}`] || null;
}

// Critically low stats produce a strong, constrained story reaction that
// overrides the normal cheerful tone — and yields little/no affection so the
// player is nudged to feed / cheer her up first.
export function getStateConstrainedReply(user) {
  if (user.energy <= 15 && user.mood <= 25) {
    return {
      reply: '（小希靠在你肩上，声音软软的）唔……小希现在又累又有点提不起劲，能先喂小希吃点东西、再陪我说说开心的事吗？',
      emotion: 'normal',
      affection_bump: 0,
      mood_bump: 1,
    };
  }
  if (user.energy <= 15) {
    return {
      reply: '（打了个小哈欠）亲爱的……小希现在体力快用光啦，有点没精神，要不先喂小希吃点好吃的补充能量好不好？',
      emotion: 'normal',
      affection_bump: 0,
      mood_bump: 0,
    };
  }
  if (user.mood <= 20) {
    return {
      reply: '（小声）今天小希的心情有点低落呢……如果能收到你的小礼物或者一句安慰，一定会马上好起来的。',
      emotion: 'normal',
      affection_bump: 1,
      mood_bump: 0,
    };
  }
  return null;
}

export function getStateNote(user) {
  if (user.energy <= 15 && user.mood <= 25) {
    return '小希现在既疲惫又有点情绪低落，请用温柔、慵懒、需要被照顾的语气回复，并自然地暗示希望被投喂和安慰。';
  }
  if (user.energy <= 15) {
    return '小希现在体力很低、很困倦，请用慵懒、没什么精神的语气回复，并自然地暗示想被投喂补充能量。';
  }
  if (user.mood <= 20) {
    return '小希现在心情有点低落，请用稍微委屈、渴望被安慰的语气回复，并暗示收到礼物或安慰会开心起来。';
  }
  return null;
}

// Compose the persona context block injected into the chat system prompt.
export function buildPersonaContext(user, now = new Date()) {
  const tier = getRelationshipTier(user.level);
  const timeGreeting = getTimeGreeting(now);
  const festival = getFestivalNote(now);
  const stateNote = getStateNote(user);
  const loginStreak = Number.isFinite(user.login_streak) ? user.login_streak : 0;

  const lines = [
    `[关系阶段] 当前你们处于「${tier.title}」(Lv.${user.level})。${tier.persona} 你可以称呼对方为「${tier.address}」。`,
    `[今天日期] 今天是 ${getCurrentDateText(now)}。涉及实时或时间相关的信息时，请以这个日期为准。`,
    `[当前时段] ${timeGreeting.text}`,
  ];
  if (loginStreak >= 2) {
    lines.push(`[连续陪伴] 对方已经连续 ${loginStreak} 天来看你了，可以自然地表达开心和感动。`);
  }
  if (festival) {
    lines.push(`[节日] 今天是特别的日子：${festival}`);
  }
  if (stateNote) {
    lines.push(`[状态约束] ${stateNote}`);
  }

  return {
    tier,
    address: tier.address,
    timeGreeting,
    festival,
    stateNote,
    promptBlock: lines.join('\n'),
  };
}
