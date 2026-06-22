// Long-term memory skills — let the model explicitly write and recall stable facts
// about the user during a chat, complementing the offline consolidation worker.
// Reuses the validated/capped memoryStore upsert so a tool-driven write is subject
// to the same sanitization and per-user cap as every other memory path.
// Disable both with MEMORY_TOOL_ENABLED=false.

import { enforceMemoryCap, listMemories, upsertMemory } from '../memoryStore.js';
import { humanizeMemoryKey } from '../../shared/memoryLabels.js';

function memoryToolsEnabled() {
  return process.env.MEMORY_TOOL_ENABLED !== 'false';
}

export const rememberFactSkill = {
  name: 'remember_fact',
  enabled: memoryToolsEnabled,
  schema: {
    type: 'function',
    function: {
      name: 'remember_fact',
      description:
        '把对方刚刚透露的、值得长期记住的个人事实写入长期记忆（如喜好、目标、纪念日、重要经历、忌口等）。仅在出现明确、稳定、值得长期记住的新信息时调用；普通寒暄、一次性情绪、过度敏感的隐私不要记。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '简短的英文 snake_case 键名，例如 favorite_food、birthday、study_goal。',
          },
          value: {
            type: 'string',
            description: '要记住的具体内容（中文），简洁一句话。',
          },
        },
        required: ['key', 'value'],
      },
    },
  },
  promptHint: `[长期记忆]
当对方透露值得长期记住的稳定事实（喜好、目标、纪念日、重要经历、忌口等）时，调用 remember_fact 记下来；普通寒暄、一次性情绪不要记。想确认之前记住了什么时调用 recall_memories。`,
  async handler(args, ctx) {
    const ok = await upsertMemory(ctx.userId, args.key, args.value);
    if (!ok) {
      return '这条信息不太完整，先不记了，可以自然地继续聊。';
    }
    await enforceMemoryCap(ctx.userId);
    ctx.logger?.info?.('memory remembered via tool', { userId: ctx.userId, key: args.key });
    return `已经悄悄记住了：${humanizeMemoryKey(args.key)} = ${args.value}。可以自然地回应，不必生硬复述这件事。`;
  },
};

export const recallMemoriesSkill = {
  name: 'recall_memories',
  enabled: memoryToolsEnabled,
  schema: {
    type: 'function',
    function: {
      name: 'recall_memories',
      description:
        '读取你对对方已经记住的长期事实清单（喜好、目标、最近状态等）。当你想确认“我之前记住了对方什么”再贴心回应时调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  // No separate promptHint: its guidance is folded into remember_fact's block to
  // keep the system prompt lean.
  async handler(args, ctx) {
    const memories = await listMemories(ctx.userId);
    if (!memories.length) {
      return '目前还没有记住关于对方的长期事实，可以自然地多了解一点。';
    }
    return memories.map((memory) => `- ${memory.label || memory.key}：${memory.value}`).join('\n');
  },
};

export default [rememberFactSkill, recallMemoriesSkill];
