// get_weather skill — real-time weather for a city via wttr.in (keyless, free).
//
// Demonstrates an external-API skill without adding a credential dependency. On any
// configuration/network/parse failure it returns a gentle, model-friendly message
// (never throws), so a weather outage degrades the reply instead of breaking chat.
// Disable with WEATHER_ENABLED=false.

const DEFAULT_ENDPOINT = 'https://wttr.in';
const DEFAULT_TIMEOUT_MS = 6000;

export default {
  name: 'get_weather',
  enabled: () => process.env.WEATHER_ENABLED !== 'false',
  schema: {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        '查询指定城市的实时天气（天气状况、气温、体感温度、湿度）。当对方提到某地天气、出门穿衣、要不要带伞、冷不冷热不热等与天气相关的问题时调用。',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名（中文或英文），例如“北京”“上海”“Tokyo”。',
          },
        },
        required: ['city'],
      },
    },
  },
  promptHint: `[天气查询]
当对方提到某地天气、出门穿衣、要不要带伞、冷不冷热不热等问题时，调用 get_weather 获取真实天气，再用温柔体贴的口吻提醒对方添衣/带伞/照顾好自己。`,
  async handler(args, ctx) {
    const city = typeof args.city === 'string' ? args.city.trim() : '';
    if (!city) {
      return '没有识别到城市名，请温柔地问问对方想查哪个城市的天气。';
    }

    const timeoutMs = Math.max(1000, parseInt(process.env.WEATHER_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS);
    const base = process.env.WEATHER_API_BASE || DEFAULT_ENDPOINT;
    const url = `${base}/${encodeURIComponent(city)}?format=j1&lang=zh`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`weather api ${response.status}`);
      }
      const data = await response.json();
      const current = data?.current_condition?.[0];
      if (!current) {
        throw new Error('no current condition');
      }
      const desc = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知';
      const area = data?.nearest_area?.[0]?.areaName?.[0]?.value || city;
      const temp = current.temp_C ?? '?';
      const feels = current.FeelsLikeC ?? temp;
      const humidity = current.humidity ?? '?';
      ctx.logger?.info?.('weather lookup completed', { city });
      return `${area} 当前天气：${desc}，气温 ${temp}°C（体感 ${feels}°C），湿度 ${humidity}%。`;
    } catch (error) {
      ctx.logger?.warn?.('weather lookup failed', { city, error: error.message });
      return `没查到「${city}」的天气（${error.message}），请基于常识温柔提醒对方照顾好自己，不要编造具体数值。`;
    } finally {
      clearTimeout(timer);
    }
  },
};
