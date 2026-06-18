import { OpenAI } from 'openai';

export function createOpenAiClient(logger) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not configured; using local simulated dialog mode');
    return null;
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
  });

  logger.info('OpenAI-compatible client initialized', {
    baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini',
  });

  return client;
}

export function getLocalAIResponse(text) {
  const cleanText = text.trim();

  if (/喜欢|爱|女朋友|抱|亲|嫁|亲爱的/.test(cleanText)) {
    const replies = [
      '（脸红）唔……突然说这个，小希会害羞的啦。不过，其实我也最喜欢你啦！',
      '亲爱的，听到你这么说，小希的心跳得好快呀……抱抱！(つ´ω`)つ',
      '只要能一直陪着你，小希就很满足了。我也超级超级喜欢你哦！',
      '（羞涩低头）那……那你可要对小希负责，一直宠着我哦！',
    ];
    return {
      reply: replies[Math.floor(Math.random() * replies.length)],
      emotion: 'blush',
      affection_bump: 5,
      mood_bump: 5,
    };
  }

  if (/吃|饿|饱|零食|面包|蛋糕|咖啡|拿铁|饭/.test(cleanText)) {
    return {
      reply: '说到吃的，小希确实有点小馋了呢~ 亲爱的，我们待会去吃好吃的大餐好不好？',
      emotion: 'happy',
      affection_bump: 2,
      mood_bump: 5,
    };
  }

  if (/漂亮|可爱|美|好看|棒|聪明|帅|甜/.test(cleanText)) {
    return {
      reply: '嘻嘻，听到你夸我，今天一天都会超开心的！小希最喜欢听你夸我啦~ (๑>◡<๑)',
      emotion: 'happy',
      affection_bump: 4,
      mood_bump: 10,
    };
  }

  if (/状态|怎么样|心情|体力|累/.test(cleanText)) {
    return {
      reply: '小希现在心情很不错哦。亲爱的，你今天累不累？如果辛苦了，小希给你讲个笑话放松一下？',
      emotion: 'normal',
      affection_bump: 1,
      mood_bump: 0,
    };
  }

  if (/早|morning|起床/.test(cleanText)) {
    return {
      reply: '早安，亲爱的！昨晚睡得好吗？今天也要元气满满地开始哦！小希会一直在心里想着你的。',
      emotion: 'normal',
      affection_bump: 2,
      mood_bump: 2,
    };
  }

  if (/晚安|睡|night/.test(cleanText)) {
    return {
      reply: '晚安，亲爱的。做个好梦哦，梦里一定要有小希~ 我们明天见！(啾)',
      emotion: 'normal',
      affection_bump: 2,
      mood_bump: 2,
    };
  }

  const defaultReplies = [
    '你在做什么呢？有没有在想小希呀？',
    '今天遇到了什么开心或者烦恼的事吗？可以随时和小希倾诉哦，小希会一直做你的忠实听众。',
    '不管发生什么，小希都站在你这边，你是我最崇拜的英雄！',
    '和你说话的时候，小希觉得连空气都是甜的呢。🥰',
    '小希会一直在这里，用温柔的拥抱和热腾腾的话语，治愈你的每一个疲惫瞬间。',
  ];

  return {
    reply: defaultReplies[Math.floor(Math.random() * defaultReplies.length)],
    emotion: 'normal',
    affection_bump: 1,
    mood_bump: 1,
  };
}
