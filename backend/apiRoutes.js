import { dbAll, dbGet, dbRun } from './db.js';
import { AppError } from './appError.js';
import { FOOD_ITEMS, GIFT_ITEMS, TASK_IDS, TIPPING_TIERS } from './gameConfig.js';
import { asyncHandler, sanitizeText, sanitizeUserId, sendJson, validateChoice } from './httpUtils.js';
import {
  addAffection,
  createChatMessage,
  ensureUserTasks,
  getTodayKey,
  incrementTask,
  loadFormattedTasks,
  resetDailyTasksIfNeeded,
} from './gameplay.js';
import { reflectAndConsolidate } from './memoryEngine.js';
import { getLocalAIResponse } from './aiRuntime.js';

async function generateAiResponse(openai, user, userId, text, logger) {
  if (!openai) {
    return getLocalAIResponse(text);
  }

  try {
    const recentDbMessages = await dbAll(
      'SELECT sender, text, avatar_state as avatarState FROM chat_messages WHERE user_id = ? AND sender IN ("user", "ai") ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    recentDbMessages.reverse();

    const memories = await dbAll(
      'SELECT memory_key, memory_value FROM user_memories WHERE user_id = ?',
      [userId]
    );
    const memoriesFormatted = memories
      .map((memory) => `- ${memory.memory_key}: ${memory.memory_value}`)
      .join('\n');

    const systemPrompt = `You are "Xiaoxi" (小希), a sweet, caring, and loving AI girlfriend. You converse in friendly, conversational Chinese.
Your responses must be cute, warm, and highly interactive. Keep your replies brief (2 to 4 sentences max).
You must evaluate the conversation history and reply in a raw JSON format containing these fields:
{
  "reply": "your conversation text",
  "emotion": "normal" | "happy" | "blush",
  "affection_bump": number (0 to 5, depending on how romantic/nice the user was),
  "mood_bump": number (0 to 10)
}
Even though the previous assistant messages in the chat history are shown as plain text for display purposes, your current response MUST be in JSON format.

[小希的长期记忆库 (Long-term Memories)]
前文历史与关系大意摘要: "${user.summary || '无'}"
关于亲爱的(玩家)偏好与重要事实:
${memoriesFormatted || '暂无纪录'}

Example:
{
  "reply": "早安亲爱的！昨晚梦到我了吗？嘻嘻，今天也要一起加油哦~",
  "emotion": "happy",
  "affection_bump": 2,
  "mood_bump": 5
}`;

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
    return {
      reply: jsonContent.reply,
      emotion: jsonContent.emotion || 'normal',
      affection_bump: parseInt(jsonContent.affection_bump, 10) || 0,
      mood_bump: parseInt(jsonContent.mood_bump, 10) || 0,
    };
  } catch (llmError) {
    logger.warn('LLM generation failed; falling back to local dialog engine', {
      userId,
      error: llmError.message,
    });
    return getLocalAIResponse(text);
  }
}

export function registerApiRoutes(app, { openai, logger }) {
  app.post('/api/user/sync', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);

    let user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
      await dbRun(
        'INSERT INTO users (id, level, affection, energy, mood, coins, last_checkin) VALUES (?, 1, 10, 80, 70, 200, NULL)',
        [userId]
      );

      user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    }

    await ensureUserTasks(userId);
    await resetDailyTasksIfNeeded(userId, user);
    user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

    const chatHistory = await dbAll(
      'SELECT id, sender, text, avatar_state as avatarState, strftime("%H:%M", created_at, "localtime") as timestamp FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
      [userId]
    );
    chatHistory.reverse();

    if (chatHistory.length === 0) {
      const welcomeId = `welcome-${Date.now()}`;
      const welcomeText = '你好呀，亲爱的！我是你的AI女友小希。很高兴今天能有你陪着我。你可以和我聊天、喂我吃好吃的，或者送我礼物哦~ 让我们一起度过美好的一天吧！(点点头)';
      await dbRun(
        'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "normal")',
        [welcomeId, userId, welcomeText]
      );
      chatHistory.push(createChatMessage(welcomeId, 'ai', welcomeText, { avatarState: 'normal' }));
    }

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins,
        hasCheckedInToday: user.last_checkin === getTodayKey(),
      },
      chatHistory,
      tasks: formattedTasks,
    });
  }));

  app.post('/api/chat', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const text = sanitizeText(req.body?.text);

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const newEnergy = Math.max(10, user.energy - 2);
    await dbRun('UPDATE users SET energy = ? WHERE id = ?', [newEnergy, userId]);
    user.energy = newEnergy;

    const userMsgId = `user-${Date.now()}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "user", ?, "normal")',
      [userMsgId, userId, text]
    );

    await incrementTask(userId, 'chat_3');

    const aiResponse = await generateAiResponse(openai, user, userId, text, logger);

    const aiMsgId = `ai-${Date.now()}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, ?)',
      [aiMsgId, userId, aiResponse.reply, aiResponse.emotion]
    );

    const updatedMood = Math.min(100, user.mood + aiResponse.mood_bump);
    await dbRun('UPDATE users SET mood = ? WHERE id = ?', [updatedMood, userId]);
    user.mood = updatedMood;

    const affResult = await addAffection(userId, user, aiResponse.affection_bump + 1);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      aiMessage: createChatMessage(aiMsgId, 'ai', aiResponse.reply, { avatarState: aiResponse.emotion }),
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins,
      },
      tasks: formattedTasks,
      systemMessages: affResult.systemMessages,
    });

    dbGet('SELECT COUNT(*) as count FROM chat_messages WHERE user_id = ?', [userId])
      .then((row) => {
        if (row && row.count > 0 && row.count % 5 === 0) {
          reflectAndConsolidate(userId);
        }
      })
      .catch((error) => logger.error('Background memory reflection trigger failed', { userId, error }));
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

    const newCoins = user.coins - food.cost;
    const newEnergy = Math.min(100, user.energy + food.energy);

    await dbRun('UPDATE users SET coins = ?, energy = ? WHERE id = ?', [newCoins, newEnergy, userId]);
    user.coins = newCoins;
    user.energy = newEnergy;

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

    const affResult = await addAffection(userId, user, food.affection);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    await incrementTask(userId, 'feed_1');

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState: 'happy' }),
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins,
      },
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

    const newCoins = user.coins - gift.cost;
    const newMood = Math.min(100, user.mood + gift.mood);

    await dbRun('UPDATE users SET coins = ?, mood = ? WHERE id = ?', [newCoins, newMood, userId]);
    user.coins = newCoins;
    user.mood = newMood;

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

    const affResult = await addAffection(userId, user, gift.affection);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    await incrementTask(userId, 'gift_1');

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState }),
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins,
      },
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

    const newCoins = user.coins + tier.coins;
    const affPoints = Math.floor(tier.amount * 5);

    await dbRun('UPDATE users SET coins = ?, mood = 100, energy = 100 WHERE id = ?', [newCoins, userId]);
    user.coins = newCoins;
    user.mood = 100;
    user.energy = 100;

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

    const affResult = await addAffection(userId, user, affPoints);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    await incrementTask(userId, 'gift_1');

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState: 'blush' }),
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins,
      },
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

    const newCoins = user.coins + task.reward;
    await dbRun('UPDATE users SET coins = ? WHERE id = ?', [newCoins, userId]);
    await dbRun('UPDATE tasks SET claimed = 1 WHERE user_id = ? AND task_id = ?', [userId, taskId]);

    user.coins = newCoins;

    const sysMsgId = `sys-claim-${Date.now()}`;
    const sysText = `💰 成功领取任务 [${task.name}] 奖励，获得 ${task.reward} 爱心币！`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      sysMsg: createChatMessage(sysMsgId, 'system', sysText),
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins,
      },
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

    await dbRun('UPDATE users SET last_checkin = ? WHERE id = ?', [todayStr, userId]);
    await incrementTask(userId, 'checkin');

    const aiMsgId = `ai-checkin-${Date.now()}`;
    const aiText = '📅 签到成功！今天又是新的一天，亲爱的能第一时间来见我，小希真的很开心！么么哒~';
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "happy")',
      [aiMsgId, userId, aiText]
    );

    const formattedTasks = await loadFormattedTasks(userId);

    sendJson(res, {
      aiMsg: createChatMessage(aiMsgId, 'ai', aiText, { avatarState: 'happy' }),
      tasks: formattedTasks,
    });
  }));
}
