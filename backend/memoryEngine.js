import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { dbGet, dbRun, dbAll } from './db.js';

dotenv.config();

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.deepseek.com/v1',
  });
}

/**
 * Asynchronous Background Reflection & Memory Consolidation Worker
 * Analyzes recent chat logs, updates the rolling relationship summary,
 * and extracts semantic facts into key-value memories.
 */
export async function reflectAndConsolidate(userId) {
  if (!openai) {
    console.log('[MemoryEngine] Skipped reflection: OPENAI_API_KEY is not defined.');
    return;
  }

  console.log(`[MemoryEngine] Starting async reflection & memory consolidation for user: ${userId}`);

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
      console.log('[MemoryEngine] Dialogue history too short to reflect. Skipping.');
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
    console.log('[MemoryEngine] Consolidation successful. Extracted JSON:', result);

    // 4. Update the DB: Summary
    if (result.summary) {
      await dbRun('UPDATE users SET summary = ? WHERE id = ?', [result.summary.trim(), userId]);
      console.log('[MemoryEngine] Database updated: users.summary');
    }

    // 5. Update the DB: Key-Value memories
    if (result.memories && typeof result.memories === 'object') {
      for (const [key, value] of Object.entries(result.memories)) {
        if (!key || !value) continue;
        
        // SQLite ON CONFLICT UPSERT syntax
        await dbRun(`
          INSERT INTO user_memories (user_id, memory_key, memory_value, updated_at) 
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, memory_key) 
          DO UPDATE SET memory_value = excluded.memory_value, updated_at = CURRENT_TIMESTAMP
        `, [userId, key.trim(), value.trim()]);
      }
      console.log(`[MemoryEngine] Database updated: user_memories (${Object.keys(result.memories).length} facts)`);
    }

  } catch (error) {
    console.error('[MemoryEngine] Error during reflection and memory consolidation:', error);
  }
}
