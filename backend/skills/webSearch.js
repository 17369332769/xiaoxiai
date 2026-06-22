// web_search skill — thin adapter over the existing Bocha integration.
//
// Reuses ../webSearch.js (schema + runner + enablement) unchanged so the proven
// Bocha logic and its tests stay intact; this file only adapts it to the skill
// contract consumed by the registry.

import { WEB_SEARCH_TOOL, isWebSearchEnabled, runWebSearch } from '../webSearch.js';

export default {
  name: 'web_search',
  enabled: () => isWebSearchEnabled(),
  schema: WEB_SEARCH_TOOL,
  promptHint: `[联网搜索能力]
当用户的问题涉及实时或外部事实信息（如新闻、赛事比分、商品价格、汇率、近期发生的事件、具体数据，或你不确定的客观事实）时，请调用 web_search 工具联网查询，绝不要凭空编造。日常的情感陪伴、撒娇、安慰、闲聊不需要搜索。`,
  async handler(args, ctx) {
    try {
      return await runWebSearch(args.query, args, ctx.logger || console);
    } catch (error) {
      ctx.logger?.warn?.('web search failed', { error: error.message });
      return `联网搜索失败，请基于已有信息温柔回应、不要编造事实。原因：${error.message}`;
    }
  },
};
