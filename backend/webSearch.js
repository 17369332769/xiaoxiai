// 博查 (Bocha) web search integration.
//
// Exposes an on-demand `web_search` tool to the chat model via OpenAI-compatible
// function calling. The underlying model (DeepSeek) has no native web access, so
// the model decides when fresh/factual info is needed, emits a tool call, and the
// backend fulfils it against Bocha's Bing-compatible Web Search API.
//
// Set BOCHA_API_KEY to enable; leave it empty to keep the chat fully offline.

const DEFAULT_ENDPOINT = 'https://api.bochaai.com/v1/web-search';
const FRESHNESS_VALUES = new Set(['noLimit', 'oneDay', 'oneWeek', 'oneMonth', 'oneYear']);

export function isWebSearchEnabled() {
  return Boolean(process.env.BOCHA_API_KEY);
}

// Tool schema advertised to the model. The description steers the model to search
// only for real-time/factual questions and never for ordinary emotional chat.
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '联网搜索实时或外部事实信息。仅在需要最新或客观事实时调用，例如天气、新闻、赛事比分、商品价格、汇率、近期发生的事件、具体数据，或你不确定的客观事实。日常的情感陪伴、撒娇、安慰、闲聊不要调用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '简洁的搜索关键词（中文或英文），不要带多余的语气词。',
        },
        freshness: {
          type: 'string',
          enum: ['noLimit', 'oneDay', 'oneWeek', 'oneMonth', 'oneYear'],
          description: '结果时效范围，默认 noLimit；查最新消息用 oneDay 或 oneWeek。',
        },
      },
      required: ['query'],
    },
  },
};

function formatResults(items) {
  if (items.length === 0) {
    return '没有找到相关的搜索结果，请基于已有信息温柔地回应，不要编造事实。';
  }

  return items
    .map((item, index) => {
      const title = item.name || '(无标题)';
      const site = item.siteName ? ` - ${item.siteName}` : '';
      const date = item.datePublished || item.dateLastCrawled || '';
      const body = (item.summary || item.snippet || '').replace(/\s+/g, ' ').trim();
      const url = item.url || '';
      const header = `[${index + 1}] ${title}${site}${date ? ` (${date})` : ''}`;
      return `${header}\n${body}${url ? `\n来源: ${url}` : ''}`;
    })
    .join('\n\n');
}

// Runs a single Bocha web search and returns a compact, model-friendly text block.
// Throws on configuration/network/API errors so the caller can decide how to degrade.
export async function runWebSearch(rawQuery, options = {}, logger = console) {
  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) {
    throw new Error('web search not configured');
  }

  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) {
    throw new Error('empty search query');
  }

  const endpoint = process.env.BOCHA_API_BASE_URL || DEFAULT_ENDPOINT;
  const count = Math.max(1, Math.min(10, parseInt(process.env.BOCHA_RESULT_COUNT, 10) || 5));
  const freshness = FRESHNESS_VALUES.has(options.freshness) ? options.freshness : 'noLimit';
  const timeoutMs = Math.max(1000, parseInt(process.env.BOCHA_TIMEOUT_MS, 10) || 6000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, freshness, summary: true, count }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Bocha API ${response.status}: ${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    const items = payload?.data?.webPages?.value;
    const list = Array.isArray(items) ? items.slice(0, count) : [];
    logger.info?.('web search completed', { query, freshness, results: list.length });
    return formatResults(list);
  } finally {
    clearTimeout(timer);
  }
}
