import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { dbGet, dbRun, dbAll } from './db.js';
import { enforceMemoryCap, pruneStaleMemories, upsertMemory } from './memoryStore.js';
import { createLogger } from './logger.js';

dotenv.config();
const logger = createLogger('memory');

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.deepseek.com/v1',
  });
}

const MEMORY_LABELS = {
  favorite_drink: '常喝饮品',
  favorite_food: '偏爱食物',
  hobby: '最近爱好',
  job: '当前身份',
  study_goal: '近期目标',
  stress_signal: '最近状态',
};

const MEMORY_CATEGORY_LABELS = {
  preference: '偏好',
  goal: '目标',
  status: '近况',
  bond: '关系',
};
const MEMORY_SOURCE_LABELS = {
  local_memory: '规则提取',
  llm_memory: '模型总结',
  summary_shift: '关系总结',
};
const MEMORY_CONFIDENCE_LABELS = {
  high: '高可信',
  medium: '中可信',
  low: '低可信',
};
const RELATIONSHIP_MEMORY_EVENT_LIMIT = 40;
const RELATIONSHIP_MEMORY_EVENT_DEDUPE_WINDOW = 8;

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, '').trim();
}

function truncateChineseText(value, maxLength = 150) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function isPatternConfig(patternSpec) {
  return typeof patternSpec === 'object' && patternSpec !== null && 'pattern' in patternSpec;
}

function getConfidenceRank(confidence) {
  if (confidence === 'high') {
    return 3;
  }

  if (confidence === 'medium') {
    return 2;
  }

  return 1;
}

function getStrongerConfidence(previousConfidence, nextConfidence) {
  return getConfidenceRank(nextConfidence) >= getConfidenceRank(previousConfidence)
    ? nextConfidence
    : previousConfidence;
}

function extractFact(text, patterns) {
  for (const patternSpec of patterns) {
    const pattern = isPatternConfig(patternSpec) ? patternSpec.pattern : patternSpec;
    const confidence = isPatternConfig(patternSpec) ? patternSpec.confidence || 'high' : 'high';
    const matched = text.match(pattern);
    if (matched?.[1]) {
      return {
        value: normalizeWhitespace(matched[1]),
        confidence,
      };
    }
  }

  return null;
}

function extractStressSignal(text) {
  if (/压力大|崩溃|难受|疲惫|加班/.test(text)) {
    return {
      value: '最近有点累，想被温柔安慰',
      confidence: 'medium',
    };
  }

  if (/累|困|忙|烦/.test(text)) {
    return {
      value: '最近有点累，想被温柔安慰',
      confidence: 'low',
    };
  }

  return null;
}

function upsertInferredMemory(memoryMap, memoryConfidenceByKey, key, match) {
  if (!match?.value) {
    return;
  }

  const previousValue = memoryMap.get(key);
  if (previousValue === match.value) {
    memoryConfidenceByKey[key] = getStrongerConfidence(
      memoryConfidenceByKey[key] || 'low',
      match.confidence || 'medium'
    );
    return;
  }

  memoryMap.set(key, match.value);
  memoryConfidenceByKey[key] = match.confidence || 'medium';
}

function inferMemoryEventCategory(memoryKey) {
  if (['favorite_drink', 'favorite_food', 'hobby'].includes(memoryKey)) {
    return 'preference';
  }

  if (memoryKey === 'study_goal') {
    return 'goal';
  }

  if (memoryKey === 'stress_signal') {
    return 'status';
  }

  return 'bond';
}

function describeMemoryTimelineEvent(memoryKey, memoryValue) {
  const label = MEMORY_LABELS[memoryKey] || memoryKey;
  return `小希刚记住了你的${label}：${memoryValue}`;
}

function inferMemoryEventConfidence(memoryKey, sourceType) {
  if (sourceType === 'summary_shift') {
    return 'medium';
  }

  if (['favorite_drink', 'favorite_food', 'study_goal', 'stress_signal'].includes(memoryKey)) {
    return 'high';
  }

  return sourceType === 'llm_memory' ? 'medium' : 'medium';
}

async function createRelationshipMemoryEvent(userId, category, text, metadata = {}) {
  if (!text) {
    return;
  }

  const sourceType = metadata.sourceType || 'local_memory';
  const confidence = metadata.confidence || 'medium';

  const recentMatches = await dbAll(
    `SELECT id
     FROM relationship_memory_events
     WHERE user_id = ? AND category = ? AND text = ?
     ORDER BY rowid DESC
     LIMIT ?`,
    [userId, category, text, RELATIONSHIP_MEMORY_EVENT_DEDUPE_WINDOW]
  );

  if (recentMatches.length > 0) {
    return;
  }

  await dbRun(
    `INSERT INTO relationship_memory_events (
       id,
       user_id,
       category,
       category_label,
       source_type,
       source_label,
       confidence,
       confidence_label,
       text
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `memory-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      category,
      MEMORY_CATEGORY_LABELS[category] || MEMORY_CATEGORY_LABELS.bond,
      sourceType,
      MEMORY_SOURCE_LABELS[sourceType] || MEMORY_SOURCE_LABELS.local_memory,
      confidence,
      MEMORY_CONFIDENCE_LABELS[confidence] || MEMORY_CONFIDENCE_LABELS.medium,
      text,
    ]
  );

  await dbRun(
    `DELETE FROM relationship_memory_events
     WHERE user_id = ?
       AND id IN (
         SELECT id
         FROM relationship_memory_events
         WHERE user_id = ?
         ORDER BY rowid DESC
         LIMIT -1 OFFSET ?
       )`,
    [userId, userId, RELATIONSHIP_MEMORY_EVENT_LIMIT]
  );
}

async function syncRelationshipMemoryEvents(userId, previousSummary, previousMemories, nextSummary, nextMemories, options = {}) {
  const previousMap = new Map(
    previousMemories.map((memory) => [memory.memory_key, memory.memory_value])
  );
  const nextEntries = Object.entries(nextMemories || {});
  const sourceType = options.sourceType || 'local_memory';
  const confidenceByKey = options.confidenceByKey || {};

  for (const [key, value] of nextEntries) {
    if (!key || !value || previousMap.get(key) === value) {
      continue;
    }

    await createRelationshipMemoryEvent(
      userId,
      inferMemoryEventCategory(key),
      describeMemoryTimelineEvent(key, value),
      {
        sourceType,
        confidence: confidenceByKey[key] || inferMemoryEventConfidence(key, sourceType),
      }
    );
  }

  if (nextSummary && nextSummary !== previousSummary) {
    await createRelationshipMemoryEvent(
      userId,
      'bond',
      '小希把你们最近的相处点滴悄悄记下来了。',
      {
        sourceType: 'summary_shift',
        confidence: 'medium',
      }
    );
  }
}

function buildLocalRelationshipResult(oldSummary, oldMemoriesList, recentMessages) {
  const memoryMap = new Map(
    oldMemoriesList.map((memory) => [memory.memory_key, memory.memory_value])
  );
  const memoryConfidenceByKey = {};
  const userMessages = recentMessages
    .filter((message) => message.sender === 'user')
    .map((message) => message.text.trim())
    .filter(Boolean);

  userMessages.forEach((text) => {
    const favoriteDrink = extractFact(text, [
      { pattern: /(?:喜欢喝|爱喝|最爱喝)([^，。！？]{1,12}(?:咖啡|拿铁|奶茶|可乐|茶|果汁))/, confidence: 'high' },
      { pattern: /(?:喜欢|最爱)([^，。！？]{1,12}(?:咖啡|拿铁|奶茶|可乐|茶|果汁))/, confidence: 'medium' },
    ]);
    upsertInferredMemory(memoryMap, memoryConfidenceByKey, 'favorite_drink', favoriteDrink);

    const favoriteFood = extractFact(text, [
      { pattern: /(?:喜欢吃|爱吃|最爱吃)([^，。！？]{1,12}(?:蛋糕|面包|火锅|拉面|米饭|饺子|烧烤|披萨|便当))/, confidence: 'high' },
      { pattern: /(?:喜欢|最爱)([^，。！？]{1,12}(?:蛋糕|面包|火锅|拉面|米饭|饺子|烧烤|披萨|便当))/, confidence: 'medium' },
    ]);
    upsertInferredMemory(memoryMap, memoryConfidenceByKey, 'favorite_food', favoriteFood);

    const hobby = extractFact(text, [
      { pattern: /(?:喜欢|爱|平时喜欢|平常喜欢)(打游戏|看电影|跑步|健身|画画|摄影|旅行|听歌|看书|编程|写代码|做饭|游泳)/, confidence: 'high' },
      { pattern: /(?:最近在|最近会)(打游戏|看电影|跑步|健身|画画|摄影|旅行|听歌|看书|编程|写代码|做饭|游泳)/, confidence: 'medium' },
    ]);
    upsertInferredMemory(memoryMap, memoryConfidenceByKey, 'hobby', hobby);

    const job = extractFact(text, [
      { pattern: /我是([^，。！？]{1,12}(?:工程师|程序员|老师|学生|设计师|产品经理|医生|护士|律师|运营))/, confidence: 'high' },
      { pattern: /在做([^，。！？]{1,12}(?:开发|设计|产品|运营|教学|医疗|法务))/, confidence: 'medium' },
    ]);
    upsertInferredMemory(memoryMap, memoryConfidenceByKey, 'job', job);

    const studyGoal = extractFact(text, [
      { pattern: /(?:准备|最近在准备)([^，。！？]{1,16}(?:考试|面试|答辩|考研|高考))/, confidence: 'high' },
      { pattern: /([^，。！？]{1,16}(?:考试|面试|答辩|考研|高考))(?:快到了|要来了|要开始了)/, confidence: 'medium' },
    ]);
    upsertInferredMemory(memoryMap, memoryConfidenceByKey, 'study_goal', studyGoal);

    upsertInferredMemory(memoryMap, memoryConfidenceByKey, 'stress_signal', extractStressSignal(text));
  });

  const summarySegments = [];
  const latestUserMessage = userMessages[userMessages.length - 1];
  if (latestUserMessage) {
    if (/喜欢|爱|想你|抱抱|亲亲/.test(latestUserMessage)) {
      summarySegments.push('最近你和小希的互动更甜了，气氛明显在升温。');
    } else if (/累|困|忙|烦|压力大|加班/.test(latestUserMessage)) {
      summarySegments.push('你最近有点疲惫，小希更想多陪陪你、安慰你。');
    } else {
      summarySegments.push('你最近愿意和小希认真聊天，关系在稳定升温。');
    }
  } else if (oldSummary) {
    summarySegments.push(oldSummary);
  }

  const memoryHighlights = Array.from(memoryMap.entries())
    .filter(([, value]) => Boolean(value))
    .slice(0, 3)
    .map(([key, value]) => `${MEMORY_LABELS[key] || key}是「${value}」`);

  if (memoryHighlights.length > 0) {
    summarySegments.push(`她记住了${memoryHighlights.join('、')}。`);
  }

  const summary = truncateChineseText(
    summarySegments.join(' ').trim() || truncateChineseText(oldSummary || '你和小希正在慢慢熟悉彼此。')
  );

  return {
    summary,
    memories: Object.fromEntries(memoryMap.entries()),
    memoryConfidenceByKey,
  };
}

export async function loadRelationshipProfile(userId) {
  const user = await dbGet('SELECT summary FROM users WHERE id = ?', [userId]);
  const memories = await dbAll(
    'SELECT memory_key, memory_value, updated_at FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 6',
    [userId]
  );
  const recentUpdates = await dbAll(
    `SELECT id, category, category_label as categoryLabel,
            source_type as sourceType, source_label as sourceLabel,
            confidence, confidence_label as confidenceLabel,
            text,
            strftime("%H:%M", created_at, "localtime") as timestamp
     FROM relationship_memory_events
     WHERE user_id = ?
     ORDER BY rowid DESC
     LIMIT 12`,
    [userId]
  );

  return {
    summary: user?.summary || '',
    highlights: memories.map((memory) => ({
      key: memory.memory_key,
      label: MEMORY_LABELS[memory.memory_key] || memory.memory_key,
      value: memory.memory_value,
      updatedAt: memory.updated_at,
    })),
    recentUpdates,
  };
}

/**
 * Asynchronous Background Reflection & Memory Consolidation Worker
 * Analyzes recent chat logs, updates the rolling relationship summary,
 * and extracts semantic facts into key-value memories.
 */
export async function reflectAndConsolidate(userId) {
  logger.info('Starting async reflection and memory consolidation', { userId });

  try {
    // 1. Fetch existing relationship summary & facts
    const user = await dbGet('SELECT summary FROM users WHERE id = ?', [userId]);
    const oldSummary = user ? user.summary : '';
    
    const oldMemoriesList = await dbAll(
      'SELECT memory_key, memory_value FROM user_memories WHERE user_id = ?',
      [userId]
    );
    const oldMemoriesFormatted = oldMemoriesList
      .map(m => `- ${m.memory_key}: ${m.memory_value}`)
      .join('\n');

    // 2. Fetch the latest 15 messages (both user and AI) chronologically
    const recentMessages = await dbAll(
      'SELECT sender, text FROM chat_messages WHERE user_id = ? AND sender IN ("user", "ai") ORDER BY created_at DESC LIMIT 15',
      [userId]
    );
    recentMessages.reverse();

    if (recentMessages.length < 3) {
      logger.debug('Dialogue history too short to reflect', { userId, messageCount: recentMessages.length });
      return;
    }

    if (!openai) {
      const localResult = buildLocalRelationshipResult(oldSummary, oldMemoriesList, recentMessages);

      if (localResult.summary) {
        await dbRun('UPDATE users SET summary = ? WHERE id = ?', [localResult.summary, userId]);
      }

      // Route the local fallback through upsertMemory so it shares the same
      // validation, reinforcement and capping guarantees as the LLM path,
      // instead of writing raw and bypassing the cap.
      for (const [key, value] of Object.entries(localResult.memories)) {
        await upsertMemory(userId, key, value);
      }
      // Keep the memory card bounded and let stale low-value facts expire.
      await pruneStaleMemories(userId);
      await enforceMemoryCap(userId);

      await syncRelationshipMemoryEvents(
        userId,
        oldSummary,
        oldMemoriesList,
        localResult.summary,
        localResult.memories,
        {
          sourceType: 'local_memory',
          confidenceByKey: localResult.memoryConfidenceByKey,
        }
      );

      logger.info('Local relationship reflection completed', {
        userId,
        hasSummary: Boolean(localResult.summary),
        memoryCount: Object.keys(localResult.memories).length,
      });
      return;
    }

    const transcript = recentMessages
      .map(m => `${m.sender === 'user' ? '玩家' : '小希'}: ${m.text}`)
      .join('\n');

    // 3. Assemble Reflection Prompt
    const systemPrompt = `You are a memory consolidation engine for an AI girlfriend companion "Xiaoxi".
Your task is to analyze the recent conversation transcript between the User (玩家) and Xiaoxi (小希), and consolidate her memory records.

Existing Summary: "${oldSummary || '无'}"
Existing Memories Card:
${oldMemoriesFormatted || '无'}

Instructions:
1. Update the "summary" string: Incorporate new milestones, events, and relationship status. Keep it under 150 Chinese characters.
2. Extract or update "memories": Key-value pairs representing facts about the user (e.g., job, hobbies, favorite food/drinks, upcoming exams, mood triggers). Keep keys short (e.g., favorite_drink, job, test_date). Max 10 keys.
3. Return the result in raw JSON format matching this schema:
{
  "summary": "updated summary text in Chinese",
  "memories": {
    "key1": "value1",
    "key2": "value2"
  }
}`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_NAME || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Dialogue transcript to analyze:\n${transcript}` }
      ],
      response_format: { type: 'json_object' },
      timeout: 15000
    });

    let contentStr = completion.choices[0].message.content || '';
    contentStr = contentStr.trim();
    if (contentStr.startsWith('```json')) contentStr = contentStr.substring(7);
    else if (contentStr.startsWith('```')) contentStr = contentStr.substring(3);
    if (contentStr.endsWith('```')) contentStr = contentStr.substring(0, contentStr.length - 3);
    contentStr = contentStr.trim();

    const result = JSON.parse(contentStr);
    logger.info('Memory consolidation completed', {
      userId,
      hasSummary: Boolean(result.summary),
      memoryCount: result.memories && typeof result.memories === 'object'
        ? Object.keys(result.memories).length
        : 0,
    });

    // 4. Update the DB: Summary
    if (result.summary) {
      await dbRun('UPDATE users SET summary = ? WHERE id = ?', [result.summary.trim(), userId]);
      logger.debug('Updated users.summary from memory consolidation', { userId });
    }

    // 5. Update the DB: Key-Value memories (upsert validates input and reinforces
    // weight on conflict; invalid/empty entries are skipped inside upsertMemory)
    if (result.memories && typeof result.memories === 'object') {
      for (const [key, value] of Object.entries(result.memories)) {
        await upsertMemory(userId, key, value);
      }
      // Let stale low-value facts expire, then keep the card bounded by evicting
      // the lowest-priority facts beyond the cap.
      await pruneStaleMemories(userId);
      await enforceMemoryCap(userId);
      logger.debug('Updated user_memories from memory consolidation', {
        userId,
        memoryCount: Object.keys(result.memories).length,
      });
    }

    await syncRelationshipMemoryEvents(
      userId,
      oldSummary,
      oldMemoriesList,
      result.summary?.trim() || '',
      result.memories || {},
      { sourceType: 'llm_memory' }
    );

  } catch (error) {
    logger.error('Error during reflection and memory consolidation', { userId, error });
  }
}
