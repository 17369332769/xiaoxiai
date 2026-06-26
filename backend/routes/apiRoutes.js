import { dbAll, dbGet, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { TASK_IDS } from '../config/gameConfig.js';
import { getEffectiveFood, getEffectiveGifts, getEffectiveTippingTiers } from '../services/configOverrides.js';
import { asyncHandler, generateId, sanitizeText, sendJson, validateChoice } from '../core/httpUtils.js';
import { REQUIRE_REGISTRATION_OTP } from '../services/verification.js';
import { getUserThemeState } from '../services/themeStore.js';
import { getUserStoryState } from '../services/storyStore.js';
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
  pruneUserChat,
  recordTransaction,
  resetDailyTasksIfNeeded,
  syncAbsoluteTask,
} from '../services/gameplay.js';
import { loadRelationshipProfile, reflectAndConsolidate } from '../services/memory/memoryEngine.js';
import { getLocalAIResponse } from '../services/ai/aiRuntime.js';
import { executeSkill, getEnabledSkills, getSkillsPromptBlock } from '../skills/registry.js';
import { checkContentSafety } from '../services/contentSafety.js';
import { buildPersonaContext, getStateConstrainedReply, getRecallGreeting } from '../services/personaEngine.js';
import { recordDailyActive, recordEvent, recordFirstTime } from '../services/analytics.js';
import { pushBroadcast } from '../services/broadcasts.js';
import { createOrder, settleOrder } from '../services/orders.js';
import { findAccountByUserId } from '../services/accounts.js';

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
${getSkillsPromptBlock()}
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

// Per-call LLM timeout. Tool use adds extra round-trips per turn.
const LLM_TIMEOUT_MS = 15000;
// Cap on output tokens per call. Bounds the cost/latency of a single generation and,
// importantly for DeepSeek's JSON Output mode, prevents the "unending whitespace
// until the token limit" stall its docs warn about from burning the full timeout —
// our replies are a small JSON object, so this is comfortably above what we need.
const LLM_MAX_TOKENS = 512;

// The local fallback (and constrained-state) replies are produced whole, with no
// token stream. Chunk them out with a small gap so the SSE path gives the same
// progressive typewriter UX as the real LLM stream — otherwise the entire reply
// arrives in one delta frame and the client appears to "snap" to the full text.
// Gap is configurable via LOCAL_STREAM_GAP_MS (0 disables the pacing).
const LOCAL_STREAM_GAP_MS = (() => {
  const n = Number(process.env.LOCAL_STREAM_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? n : 24;
})();
async function emitLocalReplyInChunks(reply, emit) {
  const textValue = String(reply || '');
  for (let i = 0; i < textValue.length; i += 2) {
    emit(textValue.slice(i, i + 2));
    if (LOCAL_STREAM_GAP_MS > 0 && i + 2 < textValue.length) {
      await new Promise((resolve) => setTimeout(resolve, LOCAL_STREAM_GAP_MS));
    }
  }
}

// Max number of model<->tool round-trips in a single user turn. Each round is one
// chat-completion call; the model may answer (no tool call) at any round. Bounds the
// tool loop. Worst case for a turn that keeps requesting tools is MAX_TOOL_ROUNDS
// tool rounds + 1 forced JSON compose call.
const MAX_TOOL_ROUNDS = 3;
// Cap on how many skill calls we actually execute across a single user turn, so a
// fan-out of tool calls can't trigger an unbounded number of side effects.
const MAX_TOOL_CALLS_PER_TURN = 5;

// Safe canned reply used when the model's output (possibly steered by untrusted tool
// results such as web-search snippets) trips the content-safety filter on the way out.
const SAFE_FALLBACK_REPLY = '这个话题小希不太方便接呢，我们聊点别的轻松的好不好？';

// Output-side safety net. Input is screened before generation, but with skills
// enabled the model also sees untrusted tool content (search/recall results) that
// could prompt-inject its reply. We re-screen the model's reply with the same filter
// and, on a hit, discard the model text for a neutral safe reply. Exported for tests.
export function screenAiReply(response, logger) {
  const safety = checkContentSafety(response.reply);
  if (safety.safe) {
    return response;
  }
  logger?.warn?.('Blocked unsafe AI reply', { category: safety.category, matched: safety.matched });
  return { reply: SAFE_FALLBACK_REPLY, emotion: 'normal', affection_bump: 0, mood_bump: 0 };
}

// Parses (and clamps) the model's raw reply into our response shape. The LLM
// output is untrusted: we strip optional code fences, require a non-empty reply,
// and clamp the numeric bumps so a bad value can't corrupt affection/mood.
export function parseAiReply(rawContent) {
  let contentStr = (rawContent || '').trim();
  if (contentStr.startsWith('```json')) contentStr = contentStr.substring(7);
  else if (contentStr.startsWith('```')) contentStr = contentStr.substring(3);
  if (contentStr.endsWith('```')) contentStr = contentStr.substring(0, contentStr.length - 3);
  contentStr = contentStr.trim();

  const jsonContent = JSON.parse(contentStr);
  if (typeof jsonContent.reply !== 'string' || !jsonContent.reply.trim()) {
    throw new Error('model reply missing required "reply" field');
  }

  return {
    reply: jsonContent.reply,
    emotion: jsonContent.emotion || 'normal',
    affection_bump: Math.max(0, Math.min(5, parseInt(jsonContent.affection_bump, 10) || 0)),
    mood_bump: Math.max(0, Math.min(10, parseInt(jsonContent.mood_bump, 10) || 0)),
  };
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

    // Default to the DeepSeek family (the deployed base model) so an unset env can't
    // send an OpenAI model id to a DeepSeek-compatible endpoint. Matches memoryEngine.
    const model = process.env.OPENAI_MODEL_NAME || 'deepseek-chat';

    let rawContent = '';
    // Tracks whether `rawContent` came from a JSON-enforced call. DeepSeek treats
    // `tools` and `response_format: json_object` as mutually exclusive modes, so the
    // tool-decision turn is not JSON-enforced and may need a forced repair call.
    let jsonForced = false;

    const enabledSkills = getEnabledSkills();

    if (enabledSkills.length > 0) {
      // Multi-round tool loop: each round is one tools-enabled chat call. The model
      // either answers directly (no tool call) or emits skill call(s); we execute
      // them via the registry, feed results back, and loop. DeepSeek treats `tools`
      // and `response_format: json_object` as mutually exclusive, so these rounds
      // are NOT JSON-enforced — a final answer is parsed with a repair fallback, and
      // if the loop ends still wanting tools we force one JSON compose (tools off).
      const tools = enabledSkills.map((skill) => skill.schema);
      const ctx = { user, userId, logger };
      let usedAnyTool = false;
      let answered = false;
      let totalToolCalls = 0;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const decision = await openai.chat.completions.create({
          model,
          messages: llmMessages,
          tools,
          tool_choice: 'auto',
          max_tokens: LLM_MAX_TOKENS,
          timeout: LLM_TIMEOUT_MS,
        });

        const message = decision.choices[0].message;
        const toolCalls = message.tool_calls || [];

        if (toolCalls.length === 0) {
          // No tool calls this round: the model produced its (hopefully JSON) reply.
          // Not JSON-enforced, so the parse step below may repair it once if needed.
          // (DeepSeek does not return content alongside tool_calls; if a model ever
          // did, the content on a tool-call round is intentionally ignored and the
          // tools are run instead.)
          rawContent = message.content || '';
          answered = true;
          break;
        }

        usedAnyTool = true;
        llmMessages.push(message);

        for (const call of toolCalls) {
          if (totalToolCalls >= MAX_TOOL_CALLS_PER_TURN) {
            // Beyond the cap we still must answer every tool_call id, or the next
            // API call errors on a missing tool response.
            llmMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: '（本轮技能调用次数已达上限，已跳过）',
            });
            continue;
          }
          totalToolCalls += 1;
          const toolResult = await executeSkill(call.function?.name, call.function?.arguments, ctx);
          llmMessages.push({ role: 'tool', tool_call_id: call.id, content: toolResult });
        }

        // Once the call budget is spent, stop looping and force a final answer below
        // rather than offer tools the model can no longer use.
        if (totalToolCalls >= MAX_TOOL_CALLS_PER_TURN) {
          break;
        }
      }

      if (!answered && usedAnyTool) {
        // Loop ended (round/call cap) while the model still wanted tools: force one
        // final JSON compose with tools removed so we always return a clean reply.
        const composed = await openai.chat.completions.create({
          model,
          messages: llmMessages,
          response_format: { type: 'json_object' },
          max_tokens: LLM_MAX_TOKENS,
          timeout: LLM_TIMEOUT_MS,
        });
        rawContent = composed.choices[0].message.content || '';
        jsonForced = true;
      }
      // Otherwise `rawContent` is the model's direct answer (jsonForced stays false);
      // the parse-with-repair step below handles non-JSON or empty output (an empty
      // answered reply parses as a failure and flows through the same repair call).
    } else {
      // No skills enabled (master switch off / all gated off): single forced-JSON
      // call — the legacy fast path with guaranteed structured output.
      const completion = await openai.chat.completions.create({
        model,
        messages: llmMessages,
        response_format: { type: 'json_object' },
        max_tokens: LLM_MAX_TOKENS,
        timeout: LLM_TIMEOUT_MS,
      });
      rawContent = completion.choices[0].message.content || '';
      jsonForced = true;
    }

    try {
      return screenAiReply(parseAiReply(rawContent), logger);
    } catch (parseError) {
      // A JSON-enforced turn that still failed to parse is a hard error.
      if (jsonForced) throw parseError;
      // Otherwise an un-forced (tools-enabled) turn didn't return clean JSON; repair
      // it with one forced-JSON call so the common (no-tool) path stays a single
      // request whenever the model already complied.
      const repair = await openai.chat.completions.create({
        model,
        messages: llmMessages,
        response_format: { type: 'json_object' },
        max_tokens: LLM_MAX_TOKENS,
        timeout: LLM_TIMEOUT_MS,
      });
      return screenAiReply(parseAiReply(repair.choices[0].message.content || ''), logger);
    }
  } catch (llmError) {
    logger.warn('LLM generation failed; falling back to local dialog engine', {
      userId,
      error: llmError.message,
    });
    return constrained || getLocalAIResponse(text, { user, memories });
  }
}

// Plain-text system prompt for the streaming path: same persona/memory context as
// the JSON path, but asks for raw reply text (no JSON, no tools) so tokens can be
// streamed straight to the client for a real typewriter.
export function buildStreamSystemPrompt(user, memories, latestUserText) {
  const persona = buildPersonaContext(user);
  return `You are "Xiaoxi" (小希), a sweet, caring, and loving AI girlfriend. Reply in warm, natural, conversational Chinese, 2 to 4 short sentences. Output ONLY the reply text — no JSON, no field labels, no surrounding quotes.

[人设与情境 (Persona & Context)]
${persona.promptBlock}
${getSkillsPromptBlock({ json: false })}
[关系摘要]
前文历史与关系大意摘要: "${user.summary || '无'}"

[小希的长期记忆库 (Long-term Memories)]
${buildMemoryContextPrompt(memories)}

[当前回复提示]
${buildReplyFocusPrompt(latestUserText, memories)}`;
}

// Lightweight server-side emotion derivation for the streaming path (the model
// streams plain text, so it can't return the structured `emotion` field). Drives
// the avatar state. Exported for tests.
export function deriveEmotion(text) {
  const t = String(text || '');
  if (/脸红|害羞|羞涩|心动|脸颊|😳|💗|💞|抱抱|亲亲|么么/.test(t)) return 'blush';
  if (/嘻嘻|哈哈|开心|太好了|嘿嘿|耶|笑|好棒|幸福/.test(t)) return 'happy';
  return 'normal';
}

// Streaming counterpart of generateAiResponse. Calls onDelta(textChunk) as tokens
// arrive and resolves to the final { reply, emotion, affection_bump, mood_bump,
// replaced }. Emotion is derived server-side (the model streams plain text, not the
// structured emotion field) and the affection/mood bumps are modest server defaults.
// `replaced` is true when the streamed text was blocked by the output safety screen
// and the authoritative reply differs from what was streamed.
//
// Skills (tools) are supported: each round is a streamed, tools-enabled call. The
// model either streams its answer directly (no tool call) or emits skill call(s),
// which we execute via the registry and feed back before streaming the next round.
// DeepSeek may prefix a tool call with a short lead-in ("好的，我来查一下…"); we stream
// it live, then fire onReset() so the client clears that preview before the real,
// tool-grounded answer streams in. The `done` frame's authoritative text is the
// final word either way.
export async function generateAiResponseStream(openai, user, userId, text, logger, onDelta, onReset) {
  const emit = typeof onDelta === 'function' ? onDelta : () => {};
  const reset = typeof onReset === 'function' ? onReset : () => {};
  const constrained = getStateConstrainedReply(user);
  if (constrained && user.energy <= 15) {
    await emitLocalReplyInChunks(constrained.reply, emit);
    return { ...constrained, replaced: false };
  }

  const memories = await dbAll(
    'SELECT memory_key, memory_value FROM user_memories WHERE user_id = ?',
    [userId]
  );

  if (!openai) {
    const local = constrained || getLocalAIResponse(text, { user, memories });
    await emitLocalReplyInChunks(local.reply, emit);
    return { ...local, replaced: false };
  }

  try {
    const recentDbMessages = await dbAll(
      'SELECT sender, text, avatar_state as avatarState FROM chat_messages WHERE user_id = ? AND sender IN ("user", "ai") ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    recentDbMessages.reverse();

    const llmMessages = [{ role: 'system', content: buildStreamSystemPrompt(user, memories, text) }];
    recentDbMessages.forEach((message) => {
      llmMessages.push({ role: message.sender === 'user' ? 'user' : 'assistant', content: message.text });
    });

    const model = process.env.OPENAI_MODEL_NAME || 'deepseek-chat';

    // One streamed chat call. Emits visible text deltas live (typewriter) and, when
    // tools are advertised, reconstructs any streamed tool_calls (id/name once,
    // arguments concatenated by index). Content is only emitted while no tool call
    // has started this round — DeepSeek sends a tool call's lead-in before the call
    // itself, so the caller resets that preview if the round turns out to be a tool
    // round. Returns { text, toolCalls }.
    const streamRound = async (messages, tools) => {
      const stream = await openai.chat.completions.create({
        model,
        messages,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
        max_tokens: LLM_MAX_TOKENS,
        stream: true,
        timeout: LLM_TIMEOUT_MS,
      });
      let acc = '';
      const toolAcc = new Map(); // call index -> { id, name, args }
      for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta || {};
        if (delta.content && toolAcc.size === 0) {
          acc += delta.content;
          emit(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const entry = toolAcc.get(idx) || { id: '', name: '', args: '' };
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
            toolAcc.set(idx, entry);
          }
        }
      }
      const toolCalls = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, e]) => ({ id: e.id, type: 'function', function: { name: e.name, arguments: e.args || '{}' } }));
      return { text: acc.trim(), toolCalls };
    };

    let full = '';
    const enabledSkills = getEnabledSkills();

    if (enabledSkills.length === 0) {
      // No skills available (master switch off / all gated off): single streamed call.
      ({ text: full } = await streamRound(llmMessages, null));
    } else {
      // Tool-enabled streaming loop, mirroring generateAiResponse's tool budget. Each
      // round streams a tools-on call; a round with no tool_calls is the final answer.
      const tools = enabledSkills.map((skill) => skill.schema);
      const ctx = { user, userId, logger };
      let totalToolCalls = 0;
      let answered = false;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const { text: roundText, toolCalls } = await streamRound(llmMessages, tools);

        if (toolCalls.length === 0) {
          // Direct answer — already streamed live this round.
          full = roundText;
          answered = true;
          break;
        }

        // Tool round: clear any lead-in we streamed before the call surfaced, then
        // record the assistant tool-call turn and execute each requested skill.
        if (roundText) reset();
        llmMessages.push({ role: 'assistant', content: roundText || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          if (totalToolCalls >= MAX_TOOL_CALLS_PER_TURN) {
            llmMessages.push({ role: 'tool', tool_call_id: call.id, content: '（本轮技能调用次数已达上限，已跳过）' });
            continue;
          }
          totalToolCalls += 1;
          const toolResult = await executeSkill(call.function?.name, call.function?.arguments, ctx);
          llmMessages.push({ role: 'tool', tool_call_id: call.id, content: toolResult });
        }
        if (totalToolCalls >= MAX_TOOL_CALLS_PER_TURN) {
          break;
        }
      }

      if (!answered) {
        // Loop ended (round/call cap) while the model still wanted tools: force one
        // final streamed answer with tools removed so we always return a reply.
        ({ text: full } = await streamRound(llmMessages, null));
      }
    }

    if (!full) throw new Error('empty streamed reply');

    // Output safety net. With skills enabled the model also sees untrusted tool
    // content (search/recall results) that could prompt-inject its reply, so we
    // re-screen the streamed text; on a hit the authoritative reply is replaced and
    // the client swaps the previewed text via the `done` frame.
    const safety = checkContentSafety(full);
    if (!safety.safe) {
      logger?.warn?.('Blocked unsafe streamed reply', { userId, category: safety.category });
      return { reply: SAFE_FALLBACK_REPLY, emotion: 'normal', affection_bump: 0, mood_bump: 0, replaced: true };
    }

    return { reply: full, emotion: deriveEmotion(full), affection_bump: 1, mood_bump: 3, replaced: false };
  } catch (llmError) {
    logger.warn('Streaming LLM failed; falling back to local dialog engine', { userId, error: llmError.message });
    const local = constrained || getLocalAIResponse(text, { user, memories });
    await emitLocalReplyInChunks(local.reply, emit);
    return { ...local, replaced: false };
  }
}

export function registerApiRoutes(app, { openai, logger, presence, resolveUser, allowSimulatedPayment = false }) {
  // Every business route below identifies the user via the authoritative
  // req.userId set by resolveUser (token-derived, or a non-bound guest id).
  app.use(['/api/user', '/api/chat', '/api/action', '/api/task', '/api/checkin', '/api/transactions'], resolveUser);

  app.post('/api/user/sync', asyncHandler(async (req, res) => {
    const userId = req.userId;

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

    // Bound chat history growth here (not in the chat path, so it can't pin the
    // chat_messages count that drives the reflection trigger). Best-effort.
    await pruneUserChat(userId).catch((error) => logger.warn('Chat history prune failed', { userId, error: error.message }));

    // Proactive recall: a returning user (not brand-new) who has been away long
    // enough gets a warm "missed you" greeting prepended to their history. Then
    // stamp last_seen so the same return can't re-trigger it.
    const nowMs = Date.now();
    const lastSeenMs = Number.isFinite(user.last_seen) ? user.last_seen : null;
    if (!isNewUser && lastSeenMs !== null) {
      const recall = getRecallGreeting(nowMs - lastSeenMs);
      if (recall) {
        const recallId = generateId('ai-recall');
        await dbRun(
          'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "ai", ?, "happy")',
          [recallId, userId, recall]
        );
        await recordEvent(userId, 'recall_greeting', {});
      }
    }
    await dbRun('UPDATE users SET last_seen = ? WHERE id = ?', [nowMs, userId]);

    const chatHistory = await dbAll(
      'SELECT id, sender, text, avatar_state as avatarState, strftime("%H:%M", created_at, "localtime") as timestamp FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
      [userId]
    );
    chatHistory.reverse();

    if (chatHistory.length === 0) {
      const persona = buildPersonaContext(user);
      const welcomeId = generateId('welcome');
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
    const themeState = await getUserThemeState(userId);
    const storyState = await getUserStoryState(userId);

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
      // Lets the client hide demo-only payment affordances (instant tip /
      // replayable callback) that would fail when simulated payment is off.
      allowSimulatedPayment,
      // Whether registration requires an OTP code (off by default); drives the
      // register form's verification-code field.
      requireRegistrationOtp: REQUIRE_REGISTRATION_OTP,
      themes: themeState,
      stories: storyState,
    });
  }));

  app.post('/api/chat', asyncHandler(async (req, res) => {
    const userId = req.userId;
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

    const userMsgId = generateId('user');
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "user", ?, "normal")',
      [userMsgId, userId, text]
    );

    await incrementTask(userId, 'chat_3');
    await incrementTask(userId, 'chat_total_50');
    await recordFirstTime(userId, 'first_chat', {});
    await recordEvent(userId, 'chat', {});

    const aiResponse = await generateAiResponse(openai, user, userId, text, logger);

    const aiMsgId = generateId('ai');
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

  // Streaming counterpart of /api/chat (Server-Sent Events). Emits `delta` events
  // as reply tokens arrive (real typewriter) and a final `done` event carrying the
  // authoritative aiMessage + updated user/tasks/relationship. The client should
  // treat `done`.aiMessage as authoritative and the deltas as a live preview.
  app.post('/api/chat/stream', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const text = sanitizeText(req.body?.text);

    // Input safety + user/energy/persist all run BEFORE the SSE stream starts, so
    // these can still be reported as normal JSON errors.
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

    const userMsgId = generateId('user');
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "user", ?, "normal")',
      [userMsgId, userId, text]
    );
    await incrementTask(userId, 'chat_3');
    await incrementTask(userId, 'chat_total_50');
    await recordFirstTime(userId, 'first_chat', {});
    await recordEvent(userId, 'chat', {});

    // Begin SSE. Past this point errors are sent as an `error` event (we can no
    // longer throw — headers are already flushed).
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // tell nginx not to buffer the stream
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let aiResponse;
    try {
      aiResponse = await generateAiResponseStream(
        openai,
        user,
        userId,
        text,
        logger,
        (delta) => send('delta', { text: delta }),
        () => send('reset', {}),
      );
    } catch (error) {
      logger.error('Streamed chat generation failed', { userId, error: error.message });
      send('error', { message: '生成回复时出错了，请稍后再试。' });
      res.end();
      return;
    }

    try {
      const aiMsgId = generateId('ai');
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

      send('done', {
        aiMessage: createChatMessage(aiMsgId, 'ai', aiResponse.reply, { avatarState: aiResponse.emotion }),
        replaced: Boolean(aiResponse.replaced),
        user: serializeUser(user),
        tasks: formattedTasks,
        systemMessages: affResult.systemMessages,
        relationship,
      });
      res.end();
    } catch (error) {
      logger.error('Streamed chat finalization failed', { userId, error: error.message });
      send('error', { message: '保存回复时出错了。' });
      res.end();
    }
  }));

  app.post('/api/action/feed', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const foodItems = getEffectiveFood();
    const foodId = validateChoice(req.body?.foodId, Object.keys(foodItems), 'foodId');
    const food = foodItems[foodId];

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

    const sysMsgId = generateId('sys-feed');
    const sysText = `🍱 你给小希喂食了 [${food.name}]！体力值 +${food.energy}，好感度 +${food.affection}。`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const aiMsgId = generateId('ai-feed');
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
    const userId = req.userId;
    const giftItems = getEffectiveGifts();
    const giftId = validateChoice(req.body?.giftId, Object.keys(giftItems), 'giftId');
    const gift = giftItems[giftId];

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

    const sysMsgId = generateId('sys-gift');
    const sysText = `🎁 你送给小希 [${gift.name}]！心情值 +${gift.mood}，好感度 +${gift.affection}。`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const aiMsgId = generateId('ai-gift');
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
    const userId = req.userId;
    const amount = String(req.body?.amount);
    const paymentMethod = validateChoice(req.body?.paymentMethod, ['wechat', 'alipay'], 'paymentMethod');
    const tier = getEffectiveTippingTiers()[String(amount)];
    if (!tier) throw new AppError(400, 'INVALID_TIP_TIER', 'Invalid tip tier');

    // SECURITY: the instant tip mints coins with NO real payment, so it is a
    // demo-only convenience. Disabled by default; in production a tip must go
    // through the signed /api/order/create -> /api/payment/callback gateway flow.
    if (!allowSimulatedPayment) {
      throw new AppError(403, 'TIP_SIMULATION_DISABLED', '即时模拟打赏已停用，请通过正式支付下单。');
    }

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

    const sysMsgId = generateId('sys-tip');
    const sysText = `💝 感谢你使用 ${paymentMethod === 'wechat' ? '微信支付' : '支付宝'} 打赏小希 ¥${tier.amount} 元！获得 ${tier.coins} 爱心币，好感度 +${affPoints}，体力与心情值回满！`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [sysMsgId, userId, sysText]
    );

    const aiMsgId = generateId('ai-tip');
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
    const userId = req.userId;
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

    const sysMsgId = generateId('sys-claim');
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
    const userId = req.userId;
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

    const aiMsgId = generateId('ai-checkin');
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
    const userId = req.userId;
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const transactions = await loadTransactions(userId);

    sendJson(res, { transactions });
  }));
}
