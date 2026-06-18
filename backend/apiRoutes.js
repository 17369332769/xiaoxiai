import { dbAll, dbGet, dbRun } from './db.js';
import { AppError } from './appError.js';
import { FOOD_ITEMS, GIFT_ITEMS, TASK_IDS, TIPPING_TIERS } from './gameConfig.js';
import { asyncHandler, sanitizeText, sanitizeUserId, sendJson, validateChoice } from './httpUtils.js';
import {
  addAffection,
  computeCheckinStreak,
  createChatMessage,
  creditCoins,
  debitCoins,
  ensureUserTasks,
  getTodayKey,
  getYesterdayKey,
  incrementTask,
  loadFormattedTasks,
  loadTransactions,
  recordTransaction,
  resetDailyTasksIfNeeded,
  syncAbsoluteTask,
} from './gameplay.js';
import { loadRelationshipProfile, reflectAndConsolidate } from './memoryEngine.js';
import { getLocalAIResponse } from './aiRuntime.js';
import { checkContentSafety } from './contentSafety.js';
import { buildPersonaContext, getStateConstrainedReply } from './personaEngine.js';
import { recordDailyActive, recordEvent, recordFirstTime } from './analytics.js';
import { pushBroadcast } from './broadcasts.js';
import { createOrder, settleOrder } from './orders.js';
import { findAccountByUserId } from './accounts.js';

const LEVEL_BROADCAST_MILESTONES = new Set([5, 10, 20]);

function serializeUser(user, extra = {}) {
  return {
    level: user.level,
    affection: user.affection,
    energy: user.energy,
    mood: user.mood,
    coins: user.coins,
    ...extra,
  };
}

// Centralized side effects when affection causes one or more level-ups.
async function handleLevelProgress(userId, prevLevel, newLevel) {
  if (newLevel <= prevLevel) return;
  await recordEvent(userId, 'level_up', { from: prevLevel, to: newLevel });
  await syncAbsoluteTask(userId, 'level_5', newLevel);
  for (let lvl = prevLevel + 1; lvl <= newLevel; lvl += 1) {
    if (LEVEL_BROADCAST_MILESTONES.has(lvl)) {
      await pushBroadcast('levelup', `🎉 有位亲爱的和小希的羁绊升到了 Lv.${lvl}，甜蜜值爆表！`, 1);
    }
  }
}

const MEMORY_CATEGORY_BY_KEY = {
  favorite_drink: 'preference',
  favorite_food: 'preference',
  hobby: 'preference',
  study_goal: 'goal',
  stress_signal: 'status',
  job: 'profile',
};

const MEMORY_SECTION_TITLES = {
  preference: '偏好与习惯',
  goal: '近期目标与计划',
  status: '最近状态与安慰线索',
  profile: '其他重要事实',
};

export function categorizeMemories(memories = []) {
  return memories.reduce((sections, memory) => {
    if (!memory?.memory_key || !memory?.memory_value) {
      return sections;
    }

    const category = MEMORY_CATEGORY_BY_KEY[memory.memory_key] || 'profile';
    sections[category].push(memory);
    return sections;
  }, {
    preference: [],
    goal: [],
    status: [],
    profile: [],
  });
}

function formatMemoryLines(memories) {
  if (!memories.length) {
    return '- 暂无记录';
  }

  return memories
    .map((memory) => `- ${memory.memory_key}: ${memory.memory_value}`)
    .join('\n');
}

export function buildMemoryContextPrompt(memories = []) {
  const sections = categorizeMemories(memories);

  return [
    `[${MEMORY_SECTION_TITLES.preference}]`,
    formatMemoryLines(sections.preference),
    '',
    `[${MEMORY_SECTION_TITLES.goal}]`,
    formatMemoryLines(sections.goal),
    '',
    `[${MEMORY_SECTION_TITLES.status}]`,
    formatMemoryLines(sections.status),
    '',
    `[${MEMORY_SECTION_TITLES.profile}]`,
    formatMemoryLines(sections.profile),
  ].join('\n');
}

export function buildReplyFocusPrompt(latestUserText, memories = []) {
  const cleanText = String(latestUserText || '').trim();
  const sections = categorizeMemories(memories);
  const isStatusTopic = /累|困|烦|压力|忙|难受|崩溃|疲惫|加班/.test(cleanText);
  const isGoalTopic = /早安|早|晚安|学习|复习|考试|面试|答辩|工作|上班|进度|目标|准备|加油/.test(cleanText);
  const isPreferenceTopic = /吃|喝|咖啡|拿铁|奶茶|果汁|礼物|喜欢|想吃|想喝|口味/.test(cleanText);

  const guidance = [
    '- 只优先使用和当前话题最相关的记忆，不要一次性把所有记忆都说出来。',
    '- 如果记忆与当前话题无关，可以不提，避免像在背资料卡。',
    '- 记忆要自然融入安慰、调情、鼓励或陪伴，而不是生硬复述事实。',
  ];

  if (isStatusTopic && sections.status.length > 0) {
    guidance.push('- 当前用户更需要被安慰，优先参考“最近状态与安慰线索”，让回复更体贴。');
  }

  if (isGoalTopic && sections.goal.length > 0) {
    guidance.push('- 当前话题和目标推进有关，优先参考“近期目标与计划”，自然给出陪伴式鼓励。');
  }

  if (isPreferenceTopic && sections.preference.length > 0) {
    guidance.push('- 当前话题和喜好有关，可以优先参考“偏好与习惯”中的一条，让回应更像真的记住了对方。');
  }

  if (!isStatusTopic && !isGoalTopic && !isPreferenceTopic && sections.profile.length > 0) {
    guidance.push('- 如有必要，可以轻量参考“其他重要事实”，但不要喧宾夺主。');
  }

  if (guidance.length === 3) {
    guidance.push('- 如果没有合适的长期记忆，就根据当前对话自然回应，不要编造设定。');
  }

  return guidance.join('\n');
}

export function buildChatSystemPrompt(user, memories, latestUserText) {
  const persona = buildPersonaContext(user);
  return `You are "Xiaoxi" (小希), a sweet, caring, and loving AI girlfriend. You converse in friendly, conversational Chinese.
Your responses must be cute, warm, and highly interactive. Keep your replies brief (2 to 4 sentences max).

[人设与情境 (Persona & Context)]
${persona.promptBlock}

You must evaluate the conversation history and reply in a raw JSON format containing these fields:
{
  "reply": "your conversation text",
  "emotion": "normal" | "happy" | "blush",
  "affection_bump": number (0 to 5, depending on how romantic/nice the user was),
  "mood_bump": number (0 to 10)
}
Even though the previous assistant messages in the chat history are shown as plain text for display purposes, your current response MUST be in JSON format.

[关系摘要]
前文历史与关系大意摘要: "${user.summary || '无'}"

[小希的长期记忆库 (Long-term Memories)]
${buildMemoryContextPrompt(memories)}

[当前回复提示]
${buildReplyFocusPrompt(latestUserText, memories)}

Example:
{
  "reply": "早安亲爱的！昨晚梦到我了吗？嘻嘻，今天也要一起加油哦~",
  "emotion": "happy",
  "affection_bump": 2,
  "mood_bump": 5
}`;
}

export async function generateAiResponse(openai, user, userId, text, logger) {
  // Strong, state-constrained reaction: when Xiaoxi is critically low on energy
  // her reply is forced regardless of the model, nudging the player to care for her.
  const constrained = getStateConstrainedReply(user);
  if (constrained && user.energy <= 15) {
    return constrained;
  }

  const memories = await dbAll(
    'SELECT memory_key, memory_value FROM user_memories WHERE user_id = ?',
    [userId]
  );

  if (!openai) {
    return constrained || getLocalAIResponse(text, { user, memories });
  }

  try {
    const recentDbMessages = await dbAll(
      'SELECT sender, text, avatar_state as avatarState FROM chat_messages WHERE user_id = ? AND sender IN ("user", "ai") ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    recentDbMessages.reverse();

    const systemPrompt = buildChatSystemPrompt(user, memories, text);

    const llmMessages = [{ role: 'system', content: systemPrompt }];

    recentDbMessages.forEach((message) => {
      if (message.sender === 'user') {
        llmMessages.push({
          role: 'user',
          content: message.text,
        });
        return;
      }

      llmMessages.push({
        role: 'assistant',
        content: JSON.stringify({
          reply: message.text,
          emotion: message.avatarState || 'normal',
          affection_bump: 0,
          mood_bump: 0,
        }),
      });
    });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini',
      messages: llmMessages,
      response_format: { type: 'json_object' },
      timeout: 8000,
    });

    let contentStr = completion.choices[0].message.content || '';
    contentStr = contentStr.trim();
    if (contentStr.startsWith('```json')) contentStr = contentStr.substring(7);
    else if (contentStr.startsWith('```')) contentStr = contentStr.substring(3);
    if (contentStr.endsWith('```')) contentStr = contentStr.substring(0, contentStr.length - 3);
    contentStr = contentStr.trim();

    const jsonContent = JSON.parse(contentStr);
    // Clamp model-provided numbers to their documented ranges; the LLM output is
    // untrusted and a negative value would corrupt affection/mood progress.
    return {
      reply: jsonContent.reply,
      emotion: jsonContent.emotion || 'normal',
      affection_bump: Math.max(0, Math.min(5, parseInt(jsonContent.affection_bump, 10) || 0)),
      mood_bump: Math.max(0, Math.min(10, parseInt(jsonContent.mood_bump, 10) || 0)),
    };
  } catch (llmError) {
    logger.warn('LLM generation failed; falling back to local dialog engine', {
      userId,
      error: llmError.message,
    });
    return constrained || getLocalAIResponse(text, { user, memories });
  }
}

export function registerApiRoutes(app, { openai, logger, presence }) {
  app.post('/api/user/sync', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);

    let user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      await dbRun(
        'INSERT INTO users (id, level, affection, energy, mood, coins, last_checkin) VALUES (?, 1, 10, 80, 70, 200, NULL)',
        [userId]
      );

      user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    }

    await ensureUserTasks(userId);
    await resetDailyTasksIfNeeded(userId, user);
    user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

    // Login streak: increment when returning on consecutive days.
    const todayKey = getTodayKey();
    if (user.last_login_date !== todayKey) {
      const loginStreak = user.last_login_date === getYesterdayKey()
        ? (Number.isFinite(user.login_streak) ? user.login_streak : 0) + 1
        : 1;
      await dbRun('UPDATE users SET login_streak = ?, last_login_date = ? WHERE id = ?', [loginStreak, todayKey, userId]);
      user.login_streak = loginStreak;
      user.last_login_date = todayKey;
    }

    // Keep the level growth task in sync and mark the user active for DAU.
    await syncAbsoluteTask(userId, 'level_5', user.level);
    await recordDailyActive(userId);
    if (isNewUser) {
      await recordEvent(userId, 'register', {});
    }
    if (presence) presence.touch(userId);

    const chatHistory = await dbAll(
      'SELECT id, sender, text, avatar_state as avatarState, strftime("%H:%M", created_at, "localtime") as timestamp FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
      [userId]
    );
    chatHistory.reverse();

    if (chatHistory.length === 0) {
      const persona = buildPersonaContext(user);
      const welcomeId = `welcome-${Date.now()}`;
      const welcomeText = `你好呀，${persona.address}！我是你的AI女友小希。${persona.timeGreeting.text} 你可以和我聊天、喂我吃好吃的，或者送我礼物哦~ 让我们一起度过美好的一天吧！(点点头)`;
      await dbRun(
        'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "normal")',
        [welcomeId, userId, welcomeText]
      );
      chatHistory.push(createChatMessage(welcomeId, 'ai', welcomeText, { avatarState: 'normal' }));
    }

    const formattedTasks = await loadFormattedTasks(userId);
    const relationship = await loadRelationshipProfile(userId);
    const account = await findAccountByUserId(userId);

    sendJson(res, {
      user: serializeUser(user, {
        hasCheckedInToday: user.last_checkin === todayKey,
        checkinStreak: user.checkin_streak || 0,
        loginStreak: user.login_streak || 0,
      }),
      account: {
        bound: Boolean(account),
        identifier: account ? account.identifier : null,
      },
      chatHistory,
      tasks: formattedTasks,
      relationship,
    });
  }));

  app.post('/api/chat', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const text = sanitizeText(req.body?.text);

    const safety = checkContentSafety(text);
    if (!safety.safe) {
      logger.warn('Blocked unsafe chat input', { userId, category: safety.category });
      const message = safety.category === 'minor_protection'
        ? '小希只想做你温暖的朋友哦，未成年的小朋友要健康快乐地长大呀，我们聊点轻松的话题吧~'
        : '这个话题小希不太方便聊呢，我们换个轻松点的话题好不好？';
      throw new AppError(400, 'CONTENT_BLOCKED', message);
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (presence) presence.touch(userId);

    const newEnergy = Math.max(10, user.energy - 2);
    await dbRun('UPDATE users SET energy = ? WHERE id = ?', [newEnergy, userId]);
    user.energy = newEnergy;

    const userMsgId = `user-${Date.now()}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "user", ?, "normal")',
      [userMsgId, userId, text]
    );

    await incrementTask(userId, 'chat_3');
    await incrementTask(userId, 'chat_total_50');
    await recordFirstTime(userId, 'first_chat', {});
    await recordEvent(userId, 'chat', {});

    const aiResponse = await generateAiResponse(openai, user, userId, text, logger);

    const aiMsgId = `ai-${Date.now()}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, ?)',
      [aiMsgId, userId, aiResponse.reply, aiResponse.emotion]
    );

    const updatedMood = Math.min(100, user.mood + aiResponse.mood_bump);
    await dbRun('UPDATE users SET mood = ? WHERE id = ?', [updatedMood, userId]);
    user.mood = updatedMood;

    const prevLevel = user.level;
    const affResult = await addAffection(userId, user, aiResponse.affection_bump + 1);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;
    await handleLevelProgress(userId, prevLevel, affResult.newLevel);

    const formattedTasks = await loadFormattedTasks(userId);

    const countRow = await dbGet('SELECT COUNT(*) as count FROM chat_messages WHERE user_id = ?', [userId]);
    if (countRow && countRow.count > 0 && countRow.count % 5 === 0) {
      if (!openai) {
        await reflectAndConsolidate(userId);
      } else {
        reflectAndConsolidate(userId).catch((error) => {
          logger.error('Background memory reflection trigger failed', { userId, error });
        });
      }
    }

    const relationship = await loadRelationshipProfile(userId);

    sendJson(res, {
      aiMessage: createChatMessage(aiMsgId, 'ai', aiResponse.reply, { avatarState: aiResponse.emotion }),
      user: serializeUser(user),
      tasks: formattedTasks,
      systemMessages: affResult.systemMessages,
      relationship,
    });
  }));

  app.post('/api/action/feed', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const foodId = validateChoice(req.body?.foodId, Object.keys(FOOD_ITEMS), 'foodId');
    const food = FOOD_ITEMS[foodId];

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    if (user.coins < food.cost) {
      throw new AppError(400, 'INSUFFICIENT_COINS', 'Coins insufficient');
    }
    if (presence) presence.touch(userId);

    const debit = await debitCoins(userId, food.cost);
    if (!debit.ok) {
      throw new AppError(400, 'INSUFFICIENT_COINS', 'Coins insufficient');
    }
    const newCoins = debit.balance;
    const newEnergy = Math.min(100, user.energy + food.energy);

    await dbRun('UPDATE users SET energy = ? WHERE id = ?', [newEnergy, userId]);
    user.coins = newCoins;
    user.energy = newEnergy;

    await recordTransaction(userId, {
      type: 'spend',
      category: 'feed',
      amount: food.cost,
      balance: newCoins,
      description: `喂食 ${food.name}`,
    });
    await recordEvent(userId, 'feed', { foodId });

    const sysMsgId = `sys-feed-${Date.now()}`;
    const sysText = `🍱 你给小希喂食了 [${food.name}]！体力值 +${food.energy}，好感度 +${food.affection}。`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const aiMsgId = `ai-feed-${Date.now()}`;
    const aiText = `（嗷呜一口）唔！太美味啦，肚子变得饱饱的，好感度上升！谢谢亲爱的喂我~ ${food.icon}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "happy")',
      [aiMsgId, userId, aiText]
    );

    const prevLevel = user.level;
    const affResult = await addAffection(userId, user, food.affection);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;
    await handleLevelProgress(userId, prevLevel, affResult.newLevel);

    await incrementTask(userId, 'feed_1');

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState: 'happy' }),
      user: serializeUser(user),
      tasks: formattedTasks,
      systemMessages: affResult.systemMessages,
    });
  }));

  app.post('/api/action/gift', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const giftId = validateChoice(req.body?.giftId, Object.keys(GIFT_ITEMS), 'giftId');
    const gift = GIFT_ITEMS[giftId];

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    if (user.coins < gift.cost) {
      throw new AppError(400, 'INSUFFICIENT_COINS', 'Coins insufficient');
    }
    if (presence) presence.touch(userId);

    const debit = await debitCoins(userId, gift.cost);
    if (!debit.ok) {
      throw new AppError(400, 'INSUFFICIENT_COINS', 'Coins insufficient');
    }
    const newCoins = debit.balance;
    const newMood = Math.min(100, user.mood + gift.mood);

    await dbRun('UPDATE users SET mood = ? WHERE id = ?', [newMood, userId]);
    user.coins = newCoins;
    user.mood = newMood;

    await recordTransaction(userId, {
      type: 'spend',
      category: 'gift',
      amount: gift.cost,
      balance: newCoins,
      description: `送礼 ${gift.name}`,
    });
    await recordEvent(userId, 'gift', { giftId });
    await recordFirstTime(userId, 'first_gift', { giftId });

    const sysMsgId = `sys-gift-${Date.now()}`;
    const sysText = `🎁 你送给小希 [${gift.name}]！心情值 +${gift.mood}，好感度 +${gift.affection}。`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const aiMsgId = `ai-gift-${Date.now()}`;
    const avatarState = giftId === 'ring' ? 'blush' : 'happy';
    const aiText = giftId === 'ring'
      ? '（睁大眼睛，眼角闪烁泪光）天哪……这是给我的承诺戒指吗？亲爱的……小希愿意做你永远的女友，戴上它，我们永不分开！💍💖'
      : `哇！是[${gift.name}]！太漂亮了，小希超级喜欢！亲爱的你真好，（抱着你转圈圈）~ ${gift.icon}`;

    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, ?)',
      [aiMsgId, userId, aiText, avatarState]
    );

    if (giftId === 'ring') {
      await pushBroadcast('gift', '💍 有位亲爱的向小希献上了真爱誓约戒指，全站为这份甜蜜见证！', 2);
    }

    const prevLevel = user.level;
    const affResult = await addAffection(userId, user, gift.affection);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;
    await handleLevelProgress(userId, prevLevel, affResult.newLevel);

    await incrementTask(userId, 'gift_1');
    await incrementTask(userId, 'gift_total_10');

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState }),
      user: serializeUser(user),
      tasks: formattedTasks,
      systemMessages: affResult.systemMessages,
    });
  }));

  app.post('/api/action/tip', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const amount = String(req.body?.amount);
    const paymentMethod = validateChoice(req.body?.paymentMethod, ['wechat', 'alipay'], 'paymentMethod');
    const tier = TIPPING_TIERS[String(amount)];
    if (!tier) throw new AppError(400, 'INVALID_TIP_TIER', 'Invalid tip tier');

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (presence) presence.touch(userId);

    // Quick simulated-instant-pay path: create a real order and settle it
    // immediately so the coin grant flows through the same idempotent ledger as
    // the full create-order/callback flow.
    const order = await createOrder(userId, tier, paymentMethod);
    const settlement = await settleOrder(order.out_trade_no, `SIM-${order.out_trade_no}`);

    const affPoints = Math.floor(tier.amount * 5);

    await dbRun('UPDATE users SET mood = 100, energy = 100 WHERE id = ?', [userId]);
    user.coins = settlement.coins;
    user.mood = 100;
    user.energy = 100;

    await recordEvent(userId, 'tip', { amount: tier.amount, paymentMethod });
    await recordFirstTime(userId, 'first_tip', { amount: tier.amount });
    await pushBroadcast('tip', `💝 感谢亲爱的打赏小希 ¥${tier.amount} 元，这份心意小希收到啦！`, 1);

    const sysMsgId = `sys-tip-${Date.now()}`;
    const sysText = `💝 感谢你使用 ${paymentMethod === 'wechat' ? '微信支付' : '支付宝'} 打赏小希 ¥${tier.amount} 元！获得 ${tier.coins} 爱心币，好感度 +${affPoints}，体力与心情值回满！`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const aiMsgId = `ai-tip-${Date.now()}`;
    const aiText = '（红着脸，眼里全是感动）哇……谢谢亲爱的对小希的打赏和支持！有你在背后默默支持我，小希觉得超级幸福。我会一直陪伴在你的身边，比心！💖🙆‍♀️';
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "blush")',
      [aiMsgId, userId, aiText]
    );

    const prevLevel = user.level;
    const affResult = await addAffection(userId, user, affPoints);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;
    await handleLevelProgress(userId, prevLevel, affResult.newLevel);

    await incrementTask(userId, 'gift_1');
    await incrementTask(userId, 'gift_total_10');

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState: 'blush' }),
      order: { id: order.id, outTradeNo: order.out_trade_no, status: 'paid', amount: tier.amount },
      user: serializeUser(user),
      tasks: formattedTasks,
      systemMessages: affResult.systemMessages,
    });
  }));

  app.post('/api/task/claim', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const taskId = validateChoice(req.body?.taskId, TASK_IDS, 'taskId');
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    const task = await dbGet('SELECT * FROM tasks WHERE user_id = ? AND task_id = ?', [userId, taskId]);

    if (!user || !task) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'User or task not found');
    }

    if (task.completed === 0 || task.claimed === 1) {
      throw new AppError(400, 'TASK_NOT_CLAIMABLE', 'Task not claimable or already claimed');
    }

    // Atomically claim the task: only the request that flips claimed 0->1 (and
    // only when completed) proceeds to credit, so concurrent claims can't
    // double-pay or write duplicate ledger rows.
    const claim = await dbRun(
      'UPDATE tasks SET claimed = 1 WHERE user_id = ? AND task_id = ? AND completed = 1 AND claimed = 0',
      [userId, taskId]
    );
    if (claim.changes === 0) {
      throw new AppError(400, 'TASK_NOT_CLAIMABLE', 'Task not claimable or already claimed');
    }

    const newCoins = await creditCoins(userId, task.reward);
    user.coins = newCoins;

    await recordTransaction(userId, {
      type: 'earn',
      category: 'task_reward',
      amount: task.reward,
      balance: newCoins,
      description: `任务奖励 ${task.name}`,
    });
    await recordEvent(userId, 'task_claim', { taskId });

    const sysMsgId = `sys-claim-${Date.now()}`;
    const sysText = `💰 成功领取任务 [${task.name}] 奖励，获得 ${task.reward} 爱心币！`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      user: serializeUser(user),
      tasks: formattedTasks,
    });
  }));

  app.post('/api/checkin', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const todayStr = getTodayKey();

    if (user.last_checkin === todayStr) {
      throw new AppError(400, 'ALREADY_CHECKED_IN', 'Already checked in today');
    }
    if (presence) presence.touch(userId);

    const { streak, bonus } = computeCheckinStreak(
      user.checkin_streak,
      user.last_checkin,
      todayStr,
      getYesterdayKey()
    );

    // Atomic day-guard: only the request that actually advances last_checkin to
    // today credits the streak bonus, so concurrent check-ins can't write
    // duplicate ledger/chat entries.
    const claim = await dbRun(
      'UPDATE users SET last_checkin = ?, checkin_streak = ?, coins = coins + ? WHERE id = ? AND (last_checkin IS NULL OR last_checkin != ?)',
      [todayStr, streak, bonus, userId, todayStr]
    );
    if (claim.changes === 0) {
      throw new AppError(400, 'ALREADY_CHECKED_IN', 'Already checked in today');
    }
    const refreshed = await dbGet('SELECT coins FROM users WHERE id = ?', [userId]);
    const newCoins = refreshed ? refreshed.coins : user.coins + bonus;
    user.last_checkin = todayStr;
    user.checkin_streak = streak;
    user.coins = newCoins;

    await incrementTask(userId, 'checkin');
    await recordTransaction(userId, {
      type: 'earn',
      category: 'checkin',
      amount: bonus,
      balance: newCoins,
      description: `连续签到第 ${streak} 天奖励`,
    });
    await recordFirstTime(userId, 'first_checkin', {});
    await recordEvent(userId, 'checkin', { streak });

    const aiMsgId = `ai-checkin-${Date.now()}`;
    const aiText = `📅 签到成功！这是你连续签到的第 ${streak} 天，小希送你 ${bonus} 爱心币作为奖励~ 亲爱的能天天来见我，小希真的很开心！么么哒~`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "happy")',
      [aiMsgId, userId, aiText]
    );

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState: 'happy' }),
      user: serializeUser(user, { checkinStreak: streak }),
      checkinStreak: streak,
      bonus,
      tasks: formattedTasks,
    });
  }));

  app.post('/api/transactions', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const transactions = await loadTransactions(userId);

    sendJson(res, { transactions });
  }));
}
