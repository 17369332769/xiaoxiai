import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { dbRun, dbGet, dbAll } from './db.js';
import { reflectAndConsolidate } from './memoryEngine.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI client if API key is provided
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
  });
  console.log('OpenAI/DeepSeek API Client initialized with base URL:', process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1');
} else {
  console.log('No OPENAI_API_KEY found in .env. Operating in local simulated dialog mode.');
}

// ----------------------------------------------------
// LOCAL DIALOG ENGINE FALLBACK
// ----------------------------------------------------
const getLocalAIResponse = (text, mood, energy) => {
  const cleanText = text.trim();
  
  if (/喜欢|爱|女朋友|抱|亲|嫁|亲爱的/.test(cleanText)) {
    const replies = [
      "（脸红）唔……突然说这个，小希会害羞的啦。不过，其实我也最喜欢你啦！",
      "亲爱的，听到你这么说，小希的心跳得好快呀……抱抱！(つ´ω`)つ",
      "只要能一直陪着你，小希就很满足了。我也超级超级喜欢你哦！",
      "（羞涩低头）那……那你可要对小希负责，一直宠着我哦！"
    ];
    return {
      reply: replies[Math.floor(Math.random() * replies.length)],
      emotion: 'blush',
      affection_bump: 5,
      mood_bump: 5
    };
  }

  if (/吃|饿|饱|零食|面包|蛋糕|咖啡|拿铁|饭/.test(cleanText)) {
    return {
      reply: "说到吃的，小希确实有点小馋了呢~ 亲爱的，我们待会去吃好吃的大餐好不好？",
      emotion: 'happy',
      affection_bump: 2,
      mood_bump: 5
    };
  }

  if (/漂亮|可爱|美|好看|棒|聪明|帅|甜/.test(cleanText)) {
    return {
      reply: "嘻嘻，听到你夸我，今天一天都会超开心的！小希最喜欢听你夸我啦~ (๑>◡<๑)",
      emotion: 'happy',
      affection_bump: 4,
      mood_bump: 10
    };
  }

  if (/状态|怎么样|心情|体力|累/.test(cleanText)) {
    return {
      reply: `小希现在心情很不错哦。亲爱的，你今天累不累？如果辛苦了，小希给你讲个笑话放松一下？`,
      emotion: 'normal',
      affection_bump: 1,
      mood_bump: 0
    };
  }

  if (/早|morning|起床/.test(cleanText)) {
    return {
      reply: "早安，亲爱的！昨晚睡得好吗？今天也要元气满满地开始哦！小希会一直在心里想着你的。",
      emotion: 'normal',
      affection_bump: 2,
      mood_bump: 2
    };
  }
  if (/晚安|睡|night/.test(cleanText)) {
    return {
      reply: "晚安，亲爱的。做个好梦哦，梦里一定要有小希~ 我们明天见！(啾)",
      emotion: 'normal',
      affection_bump: 2,
      mood_bump: 2
    };
  }

  const defaultReplies = [
    "你在做什么呢？有没有在想小希呀？",
    "今天遇到了什么开心或者烦恼的事吗？可以随时和小希倾诉哦，小希会一直做你的忠实听众。",
    "不管发生什么，小希都站在你这边，你是我最崇拜的英雄！",
    "和你说话的时候，小希觉得连空气都是甜的呢。🥰",
    "小希会一直在这里，用温柔的拥抱和热腾腾的话语，治愈你的每一个疲惫瞬间。"
  ];
  return {
    reply: defaultReplies[Math.floor(Math.random() * defaultReplies.length)],
    emotion: 'normal',
    affection_bump: 1,
    mood_bump: 1
  };
};

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Sync User / Load Profile & Tasks
app.post('/api/user/sync', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Try to get user
    let user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
      // Register new user
      await dbRun(
        'INSERT INTO users (id, level, affection, energy, mood, coins, last_checkin) VALUES (?, 1, 10, 80, 70, 200, NULL)',
        [userId]
      );
      
      // Seed initial tasks for this user
      const defaultTasks = [
        { id: 'checkin', name: '每日小希签到 (Daily Check-in)', target: 1, reward: 50 },
        { id: 'chat_3', name: '和小希对话3次 (Chat 3 times)', target: 3, reward: 30 },
        { id: 'feed_1', name: '给小希喂食一次 (Feed Xiaoxi 1 time)', target: 1, reward: 40 },
        { id: 'gift_1', name: '赠送小希任意精美礼物 (Give 1 Gift)', target: 1, reward: 60 }
      ];
      
      for (const t of defaultTasks) {
        await dbRun(
          'INSERT INTO tasks (user_id, task_id, name, reward, progress, target, completed, claimed) VALUES (?, ?, ?, ?, 0, ?, 0, 0)',
          [userId, t.id, t.name, t.reward, t.target]
        );
      }

      user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    }

    // Load recent chat history (most recent 40 messages, chronologically sorted)
    const chatHistory = await dbAll(
      'SELECT id, sender, text, avatar_state as avatarState, strftime("%H:%M", created_at, "localtime") as timestamp FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
      [userId]
    );
    chatHistory.reverse();

    // If chat history is empty, insert the initial AI greeting
    if (chatHistory.length === 0) {
      const welcomeId = `welcome-${Date.now()}`;
      const welcomeText = '你好呀，亲爱的！我是你的AI女友小希。很高兴今天能有你陪着我。你可以和我聊天、喂我吃好吃的，或者送我礼物哦~ 让我们一起度过美好的一天吧！(点点头)';
      await dbRun(
        'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "normal")',
        [welcomeId, userId, welcomeText]
      );
      chatHistory.push({
        id: welcomeId,
        sender: 'ai',
        text: welcomeText,
        avatarState: 'normal',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }

    // Load tasks
    const tasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);

    // Format tasks boolean fields (SQLite uses 0/1)
    const formattedTasks = tasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins
      },
      chatHistory,
      tasks: formattedTasks
    });
  } catch (error) {
    console.error('Error in /api/user/sync:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Helper to progress task in DB
async function incrementTask(userId, taskId, amount = 1) {
  const task = await dbGet('SELECT * FROM tasks WHERE user_id = ? AND task_id = ?', [userId, taskId]);
  if (task && task.completed === 0) {
    const newProgress = Math.min(task.target, task.progress + amount);
    const completed = newProgress >= task.target ? 1 : 0;
    await dbRun(
      'UPDATE tasks SET progress = ?, completed = ? WHERE user_id = ? AND task_id = ?',
      [newProgress, completed, userId, taskId]
    );
  }
}

// Helper to add level progress / level up
async function addAffection(userId, user, points) {
  let newAffection = user.affection + points;
  let newLevel = user.level;
  const maxAffection = 100 + (newLevel - 1) * 50;
  let systemMsg = null;

  if (newAffection >= maxAffection) {
    newAffection -= maxAffection;
    newLevel += 1;
    
    // Create level up system message
    const msgId = `sys-level-${Date.now()}`;
    const levelUpText = `🎉 恭喜！你们的羁绊等级提升到了 Lv.${newLevel}！小希对你更信任了哦~`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [msgId, userId, levelUpText]
    );
    systemMsg = {
      id: msgId,
      sender: 'system',
      text: levelUpText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  }

  await dbRun('UPDATE users SET level = ?, affection = ? WHERE id = ?', [newLevel, newAffection, userId]);
  return { newLevel, newAffection, systemMsg };
}

// 2. Chat with AI Girlfriend
app.post('/api/chat', async (req, res) => {
  const { userId, text } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId and text are required' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Deduct energy slightly
    const newEnergy = Math.max(10, user.energy - 2);
    await dbRun('UPDATE users SET energy = ? WHERE id = ?', [newEnergy, userId]);
    user.energy = newEnergy;

    // Record user message
    const userMsgId = `user-${Date.now()}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "user", ?, "normal")',
      [userMsgId, userId, text]
    );

    // Update dialogue task progress
    await incrementTask(userId, 'chat_3');
    // Generate response (Real LLM or Local Fallback)
    let aiResponse = null;

    if (openai) {
      try {
        // Fetch recent 10 messages from database to serve as conversation context
        const recentDbMessages = await dbAll(
          'SELECT sender, text, avatar_state as avatarState FROM chat_messages WHERE user_id = ? AND sender IN ("user", "ai") ORDER BY created_at DESC LIMIT 10',
          [userId]
        );
        recentDbMessages.reverse();

        // Fetch user memories (Semantic Memory)
        const memories = await dbAll(
          'SELECT memory_key, memory_value FROM user_memories WHERE user_id = ?',
          [userId]
        );
        const memoriesFormatted = memories
          .map(m => `- ${m.memory_key}: ${m.memory_value}`)
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

        const llmMessages = [
          { role: 'system', content: systemPrompt }
        ];

        recentDbMessages.forEach(msg => {
          if (msg.sender === 'user') {
            llmMessages.push({
              role: 'user',
              content: msg.text
            });
          } else {
            // Format previous assistant messages as JSON to conform with the JSON Mode prompt requirements
            llmMessages.push({
              role: 'assistant',
              content: JSON.stringify({
                reply: msg.text,
                emotion: msg.avatarState || 'normal',
                affection_bump: 0,
                mood_bump: 0
              })
            });
          }
        });

        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini',
          messages: llmMessages,
          response_format: { type: 'json_object' },
          timeout: 8000 // 8s timeout to keep interaction responsive
        });

        let contentStr = completion.choices[0].message.content || '';
        contentStr = contentStr.trim();
        if (contentStr.startsWith('```json')) contentStr = contentStr.substring(7);
        else if (contentStr.startsWith('```')) contentStr = contentStr.substring(3);
        if (contentStr.endsWith('```')) contentStr = contentStr.substring(0, contentStr.length - 3);
        contentStr = contentStr.trim();

        const jsonContent = JSON.parse(contentStr);
        aiResponse = {
          reply: jsonContent.reply,
          emotion: jsonContent.emotion || 'normal',
          affection_bump: parseInt(jsonContent.affection_bump) || 0,
          mood_bump: parseInt(jsonContent.mood_bump) || 0
        };
      } catch (llmError) {
        console.error('LLM generation error, falling back to local dialog engine:', llmError.message);
        aiResponse = getLocalAIResponse(text, user.mood, user.energy);
      }
    } else {
      aiResponse = getLocalAIResponse(text, user.mood, user.energy);
    }

    // Record AI Response
    const aiMsgId = `ai-${Date.now()}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, ?)',
      [aiMsgId, userId, aiResponse.reply, aiResponse.emotion]
    );

    // Apply affection and mood bumps
    const updatedMood = Math.min(100, user.mood + aiResponse.mood_bump);
    await dbRun('UPDATE users SET mood = ? WHERE id = ?', [updatedMood, userId]);
    user.mood = updatedMood;

    const affResult = await addAffection(userId, user, aiResponse.affection_bump + 1); // +1 default per message
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    // Load final items to return
    const updatedTasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);
    const formattedTasks = updatedTasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      aiMessage: {
        id: aiMsgId,
        sender: 'ai',
        text: aiResponse.reply,
        avatarState: aiResponse.emotion,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      systemMessage: affResult.systemMsg,
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins
      },
      tasks: formattedTasks
    });

    // Trigger background memory consolidation asynchronously (every 5 turns)
    dbGet('SELECT COUNT(*) as count FROM chat_messages WHERE user_id = ?', [userId])
      .then(row => {
        if (row && row.count > 0 && row.count % 5 === 0) {
          reflectAndConsolidate(userId);
        }
      })
      .catch(err => console.error('[Server] Background memory reflection trigger failed:', err));

  } catch (error) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 3. Feed Xiaoxi Action
app.post('/api/action/feed', async (req, res) => {
  const { userId, foodId, cost, energy, affection, name, icon } = req.body;
  if (!userId || !foodId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.coins < cost) {
      return res.status(400).json({ error: 'Coins insufficient' });
    }

    const newCoins = user.coins - cost;
    const newEnergy = Math.min(100, user.energy + energy);
    
    await dbRun('UPDATE users SET coins = ?, energy = ? WHERE id = ?', [newCoins, newEnergy, userId]);
    user.coins = newCoins;
    user.energy = newEnergy;

    // Record system notification message
    const sysMsgId = `sys-feed-${Date.now()}`;
    const sysText = `🍱 你给小希喂食了 [${name}]！体力值 +${energy}，好感度 +${affection}。`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    // Record AI happy response message
    const aiMsgId = `ai-feed-${Date.now()}`;
    const aiText = `（嗷呜一口）唔！太美味啦，肚子变得饱饱的，好感度上升！谢谢亲爱的喂我~ ${icon}`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "happy")',
      [aiMsgId, userId, aiText]
    );

    // Apply affection
    const affResult = await addAffection(userId, user, affection);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    // Progress task
    await incrementTask(userId, 'feed_1');

    const updatedTasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);
    const formattedTasks = updatedTasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      sysMsg: {
        id: sysMsgId,
        sender: 'system',
        text: sysText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      aiMsg: {
        id: aiMsgId,
        sender: 'ai',
        text: aiText,
        avatarState: 'happy',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins
      },
      tasks: formattedTasks,
      systemLevelMsg: affResult.systemMsg
    });
  } catch (error) {
    console.error('Error in /api/action/feed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 4. Gift Xiaoxi Action
app.post('/api/action/gift', async (req, res) => {
  const { userId, giftId, cost, mood, affection, name, icon } = req.body;
  if (!userId || !giftId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.coins < cost) {
      return res.status(400).json({ error: 'Coins insufficient' });
    }

    const newCoins = user.coins - cost;
    const newMood = Math.min(100, user.mood + mood);
    
    await dbRun('UPDATE users SET coins = ?, mood = ? WHERE id = ?', [newCoins, newMood, userId]);
    user.coins = newCoins;
    user.mood = newMood;

    // Record system notification
    const sysMsgId = `sys-gift-${Date.now()}`;
    const sysText = `🎁 你送给小希 [${name}]！心情值 +${mood}，好感度 +${affection}。`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    // Record AI response
    const aiMsgId = `ai-gift-${Date.now()}`;
    const avatarState = giftId === 'ring' ? 'blush' : 'happy';
    const aiText = giftId === 'ring'
      ? `（睁大眼睛，眼角闪烁泪光）天哪……这是给我的承诺戒指吗？亲爱的……小希愿意做你永远的女友，戴上它，我们永不分开！💍💖`
      : `哇！是[${name}]！太漂亮了，小希超级喜欢！亲爱的你真好，（抱着你转圈圈）~ ${icon}`;
    
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, ?)',
      [aiMsgId, userId, aiText, avatarState]
    );

    // Apply affection
    const affResult = await addAffection(userId, user, affection);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    // Progress task
    await incrementTask(userId, 'gift_1');

    const updatedTasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);
    const formattedTasks = updatedTasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      sysMsg: {
        id: sysMsgId,
        sender: 'system',
        text: sysText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      aiMsg: {
        id: aiMsgId,
        sender: 'ai',
        text: aiText,
        avatarState,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins
      },
      tasks: formattedTasks,
      systemLevelMsg: affResult.systemMsg
    });
  } catch (error) {
    console.error('Error in /api/action/gift:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 5. Tipping / Support Xiaoxi
app.post('/api/action/tip', async (req, res) => {
  const { userId, amount, paymentMethod, coinsGranted, label } = req.body;
  if (!userId || !amount) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newCoins = user.coins + coinsGranted;
    const affPoints = Math.floor(amount * 5);
    
    // Recharge stats
    await dbRun('UPDATE users SET coins = ?, mood = 100, energy = 100 WHERE id = ?', [newCoins, userId]);
    user.coins = newCoins;
    user.mood = 100;
    user.energy = 100;

    // Record system notification
    const sysMsgId = `sys-tip-${Date.now()}`;
    const sysText = `💝 感谢你使用 ${paymentMethod === 'wechat' ? '微信支付' : '支付宝'} 打赏小希 ¥${amount} 元！获得 ${coinsGranted} 爱心币，好感度 +${affPoints}，体力与心情值回满！`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    // Record AI grateful response
    const aiMsgId = `ai-tip-${Date.now()}`;
    const aiText = `（红着脸，眼里全是感动）哇……谢谢亲爱的对小希的打赏和支持！有你在背后默默支持我，小希觉得超级幸福。我会一直陪伴在你的身边，比心！💖🙆‍♀️`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "blush")',
      [aiMsgId, userId, aiText]
    );

    // Apply affection
    const affResult = await addAffection(userId, user, affPoints);
    user.level = affResult.newLevel;
    user.affection = affResult.newAffection;

    // Progress gift task if not done
    await incrementTask(userId, 'gift_1');

    const updatedTasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);
    const formattedTasks = updatedTasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      sysMsg: {
        id: sysMsgId,
        sender: 'system',
        text: sysText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      aiMsg: {
        id: aiMsgId,
        sender: 'ai',
        text: aiText,
        avatarState: 'blush',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins
      },
      tasks: formattedTasks,
      systemLevelMsg: affResult.systemMsg
    });
  } catch (error) {
    console.error('Error in /api/action/tip:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 6. Claim Task Reward
app.post('/api/task/claim', async (req, res) => {
  const { userId, taskId } = req.body;
  if (!userId || !taskId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    const task = await dbGet('SELECT * FROM tasks WHERE user_id = ? AND task_id = ?', [userId, taskId]);
    
    if (!user || !task) {
      return res.status(404).json({ error: 'User or task not found' });
    }

    if (task.completed === 0 || task.claimed === 1) {
      return res.status(400).json({ error: 'Task not claimable or already claimed' });
    }

    const newCoins = user.coins + task.reward;
    await dbRun('UPDATE users SET coins = ? WHERE id = ?', [newCoins, userId]);
    await dbRun('UPDATE tasks SET claimed = 1 WHERE user_id = ? AND task_id = ?', [userId, taskId]);
    
    user.coins = newCoins;

    // Record system claim log
    const sysMsgId = `sys-claim-${Date.now()}`;
    const sysText = `💰 成功领取任务 [${task.name}] 奖励，获得 ${task.reward} 爱心币！`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const updatedTasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);
    const formattedTasks = updatedTasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      sysMsg: {
        id: sysMsgId,
        sender: 'system',
        text: sysText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      user: {
        level: user.level,
        affection: user.affection,
        energy: user.energy,
        mood: user.mood,
        coins: user.coins
      },
      tasks: formattedTasks
    });

  } catch (error) {
    console.error('Error in /api/task/claim:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// 7. Daily Check-in Action
app.post('/api/checkin', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const todayStr = new Date().toLocaleDateString('zh-CN'); // e.g. "2026/6/17"
    
    if (user.last_checkin === todayStr) {
      return res.status(400).json({ error: 'Already checked in today' });
    }

    // Update check-in date
    await dbRun('UPDATE users SET last_checkin = ? WHERE id = ?', [todayStr, userId]);
    
    // Complete check-in task
    await incrementTask(userId, 'checkin');

    // Record AI check-in response
    const aiMsgId = `ai-checkin-${Date.now()}`;
    const aiText = `📅 签到成功！今天又是新的一天，亲爱的能第一时间来见我，小希真的很开心！么么哒~`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "happy")',
      [aiMsgId, userId, aiText]
    );

    const updatedTasks = await dbAll('SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?', [userId]);
    const formattedTasks = updatedTasks.map(t => ({
      ...t,
      completed: t.completed === 1,
      claimed: t.claimed === 1
    }));

    res.json({
      aiMsg: {
        id: aiMsgId,
        sender: 'ai',
        text: aiText,
        avatarState: 'happy',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      },
      tasks: formattedTasks
    });
  } catch (error) {
    console.error('Error in /api/checkin:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
