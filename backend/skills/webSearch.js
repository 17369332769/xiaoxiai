// web_search skill — thin adapter over the existing Bocha integration.
//
// Reuses ../webSearch.js (schema + runner + enablement) unchanged so the proven
// Bocha logic and its tests stay intact; this file only adapts it to the skill
// contract consumed by the registry.

import { WEB_SEARCH_TOOL, isWebSearchEnabled, runWebSearch } from '../services/ai/webSearch.js';

export default {
  name: 'web_search',
  enabled: () => isWebSearchEnabled(),
  schema: WEB_SEARCH_TOOL,
  promptHint: `[联网搜索能力]
当用户的问题涉及实时或外部事实信息时，必须调用 web_search 工具联网查询，绝不凭记忆或想象作答——你的训练知识可能已经过时。典型场景：新闻、天气、赛事比分、商品价格、汇率、近期或当下发生的事件，以及任何关于“最新/最近/现在/今年”某人、某公司、某产品、某技术的进展、动态、动作或版本（例如“OpenAI 最近有什么新动作”）。
特别注意：如果你打算在回复里说“我查一下 / 打开手机看看 / 让我搜搜”这类话，就必须真的调用 web_search，绝不能假装查过却凭记忆编造结果。
日常的情感陪伴、撒娇、安慰、闲聊不需要搜索。`,
  async handler(args, ctx) {
    try {
      return await runWebSearch(args.query, args, ctx.logger || console);
    } catch (error) {
      ctx.logger?.warn?.('web search failed', { error: error.message });
      return `联网搜索失败，请基于已有信息温柔回应、不要编造事实。原因：${error.message}`;
    }
  },
};
