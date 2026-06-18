const SIMULATED_NAMES = ['萌萌哒小野猫', '星空下的漫步者', '夏日微风', '代码搬运工', '爱希一万年', '云端男友', '泡泡糖', '橘子汽水', '青衫折扇', '微光'];
const SIMULATED_GIFTS = ['香浓拿铁 ☕', '红丝绒蛋糕 🍰', '水晶玫瑰 🌹', '流星项链 💖', '爱心便当 🍱', '真爱誓约戒指 💍'];

function randomArrayItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function getOrCreateUserId(storage = localStorage) {
  let id = storage.getItem('xxa_user_id');
  if (!id) {
    id = `user_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString().slice(-4)}`;
    storage.setItem('xxa_user_id', id);
  }
  return id;
}

export function createTimestampedMessage(id, sender, text, extra = {}) {
  return {
    id,
    sender,
    text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    ...extra,
  };
}

export function buildSyncFailureMessage() {
  return createTimestampedMessage(
    `sys-sync-err-${Date.now()}`,
    'system',
    '⚠️ 无法连接至后端数据库服务，请确认后端项目已启动 (node server.js)。本地数据暂时无法加载！'
  );
}

export function buildChatFailureMessage() {
  return createTimestampedMessage(
    `sys-err-${Date.now()}`,
    'system',
    '⚠️ 连接后端服务器失败，请确认后端已启动。'
  );
}

export function buildRelationshipUpdateSystemMessage(updateMessage) {
  return createTimestampedMessage(
    `sys-memory-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    'system',
    `📝 记忆更新：${updateMessage}`
  );
}

export function buildRelationshipRecentUpdate(updateMessage) {
  const category = inferRelationshipUpdateCategory(updateMessage);

  return {
    id: `memory-recent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category,
    categoryLabel: getRelationshipUpdateCategoryLabel(category),
    text: updateMessage,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

export function replaceTemporaryChatMessage(history, tempId, aiMessage, systemMessages = []) {
  const updated = history.map((message) => (
    message.id === tempId
      ? { ...message, id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }
      : message
  ));

  updated.push(aiMessage);
  if (systemMessages.length) {
    updated.push(...systemMessages);
  }

  return updated;
}

export function appendServerMessages(history, primaryMessages, systemMessages = []) {
  const nextMessages = Array.isArray(primaryMessages) ? primaryMessages : [primaryMessages];
  const updated = [...history, ...nextMessages];

  if (systemMessages.length) {
    updated.push(...systemMessages);
  }

  return updated;
}

export function trimRecentEvents(history, eventText, limit = 10) {
  return [eventText, ...history].slice(0, limit);
}

export function createSimulatedRecentEvent() {
  const name = randomArrayItem(SIMULATED_NAMES);
  const gift = randomArrayItem(SIMULATED_GIFTS);
  const isTip = Math.random() > 0.6;

  if (isTip) {
    const amount = randomArrayItem([5, 52, 131.4]);
    return `玩家「${name}」刚刚打赏了小希 ¥${amount} 元！小希比心感谢~ 💖`;
  }

  return `玩家「${name}」刚刚在商店买下了 [${gift}] 送给小希！`;
}

export function applyUserSnapshot(snapshot, setters) {
  setters.setLevel(snapshot.level);
  setters.setAffection(snapshot.affection);
  setters.setEnergy(snapshot.energy);
  setters.setMood(snapshot.mood);
  setters.setCoins(snapshot.coins);
}

export function normalizeRelationshipProfile(profile) {
  return {
    summary: profile?.summary || '',
    highlights: Array.isArray(profile?.highlights) ? profile.highlights : [],
    recentUpdates: Array.isArray(profile?.recentUpdates) ? profile.recentUpdates : [],
  };
}

export function buildRelationshipFingerprint(profile) {
  const normalized = normalizeRelationshipProfile(profile);
  const summaryPart = normalized.summary.trim();
  const highlightPart = normalized.highlights
    .map((item) => `${item.key}:${item.value}`)
    .sort()
    .join('|');
  const recentUpdatesPart = normalized.recentUpdates
    .map((item) => `${item.category || 'bond'}:${item.text}`)
    .join('|');

  return `${summaryPart}::${highlightPart}::${recentUpdatesPart}`;
}

export function describeRelationshipUpdate(previousProfile, nextProfile) {
  const previous = normalizeRelationshipProfile(previousProfile);
  const next = normalizeRelationshipProfile(nextProfile);

  if (!next.summary && next.highlights.length === 0) {
    return '';
  }

  const previousHighlights = new Map(
    previous.highlights.map((item) => [item.key, item.value])
  );
  const newHighlight = next.highlights.find((item) => previousHighlights.get(item.key) !== item.value);
  if (newHighlight) {
    return `小希刚记住了你的${newHighlight.label}：${newHighlight.value}`;
  }

  if (next.summary && next.summary !== previous.summary) {
    return '小希把你们最近的相处点滴悄悄记下来了。';
  }

  return '';
}

export function appendRecentRelationshipUpdate(history, updateMessage, limit = 4) {
  if (!updateMessage) {
    return history;
  }

  if (history[0]?.text === updateMessage) {
    return history;
  }

  return [buildRelationshipRecentUpdate(updateMessage), ...history].slice(0, limit);
}

export function inferRelationshipUpdateCategory(updateMessage) {
  if (!updateMessage) {
    return 'bond';
  }

  if (/饮品|食物|喜欢|爱好|偏好/.test(updateMessage)) {
    return 'preference';
  }

  if (/目标|考试|面试|答辩|计划/.test(updateMessage)) {
    return 'goal';
  }

  if (/最近|状态|累|忙|疲惫|压力/.test(updateMessage)) {
    return 'status';
  }

  return 'bond';
}

export function getRelationshipUpdateCategoryLabel(category) {
  switch (category) {
    case 'preference':
      return '偏好';
    case 'goal':
      return '目标';
    case 'status':
      return '近况';
    case 'bond':
    default:
      return '关系';
  }
}
