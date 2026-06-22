// get_game_status skill — lets the model read Xiaoxi's real growth/relationship
// state instead of inventing numbers. Pure internal read (no external calls, no
// writes), so it is always available. Reads the already-loaded `ctx.user` row.

import { getRelationshipTier } from '../gameConfig.js';

export default {
  name: 'get_game_status',
  enabled: () => true,
  schema: {
    type: 'function',
    function: {
      name: 'get_game_status',
      description:
        '查询你（小希）与对方当前真实的养成状态：羁绊等级、好感度、你的体力与心情、金币余额、连续签到/陪伴天数。当对方问“你现在怎么样/心情体力如何/我们到几级了/好感度多少/我还有多少金币/签到几天了”等与当前状态、数值或进度相关的问题时调用，避免凭空编造数值。日常情感闲聊无需调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  promptHint: `[养成状态查询]
当对方询问你们当前的羁绊等级、好感度、你的体力/心情、金币余额、连续签到或陪伴天数等具体数值或进度时，调用 get_game_status 获取真实数据再回答，不要编造数字。`,
  async handler(args, ctx) {
    const user = ctx.user || {};
    const tier = getRelationshipTier(user.level || 1);
    const parts = [
      `羁绊等级：Lv.${user.level ?? 1}（${tier.title}）`,
      `好感度：${user.affection ?? 0}`,
      `小希体力：${user.energy ?? 0}/100`,
      `小希心情：${user.mood ?? 0}/100`,
      `金币余额：${user.coins ?? 0}`,
    ];
    if (Number.isFinite(user.checkin_streak) && user.checkin_streak > 0) {
      parts.push(`连续签到：${user.checkin_streak} 天`);
    }
    if (Number.isFinite(user.login_streak) && user.login_streak > 0) {
      parts.push(`连续陪伴：${user.login_streak} 天`);
    }
    return parts.join('；') + '。';
  },
};
