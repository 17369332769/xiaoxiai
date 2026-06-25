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

function normalizeMemoryLookup(memories = []) {
  return new Map(
    memories
      .filter((memory) => memory?.memory_key && memory?.memory_value)
      .map((memory) => [memory.memory_key, memory.memory_value])
  );
}

function pickReply(replies) {
  return replies[Math.floor(Math.random() * replies.length)];
}

function containsAny(text, pattern) {
  return pattern.test(text);
}

function buildGoalSupportReply(goal, stress) {
  if (stress) {
    return `小希知道你一边惦记着${goal}，一边也已经有点疲惫了。别一个人硬撑嘛，先让我抱抱你，再陪你把接下来的节奏慢慢理顺，好不好？`;
  }

  return `小希还记得你最近在准备${goal}呢。你已经很认真啦，接下来就一步一步来，我会在旁边一直给你打气。`;
}

function buildStatusComfortReply(stress, goal) {
  if (goal) {
    return `小希知道你最近为了${goal}真的花了很多心力。${stress}的时候，就先别逼自己啦，来我这里靠一会儿，我陪你缓一缓。`;
  }

  return `小希记得你最近状态不算轻松呢。${stress}的时候，就把肩膀借给我靠一会儿，好不好？`;
}

export function getLocalAIResponse(text, context = {}) {
  const cleanText = text.trim();
  const memoryMap = normalizeMemoryLookup(context.memories);
  const rememberedDrink = memoryMap.get('favorite_drink');
  const rememberedFood = memoryMap.get('favorite_food');
  const rememberedGoal = memoryMap.get('study_goal');
  const rememberedStress = memoryMap.get('stress_signal');
  const rememberedHobby = memoryMap.get('hobby');
  const rememberedJob = memoryMap.get('job');
  const isFoodOrDrinkTopic = containsAny(cleanText, /吃|饿|饱|零食|面包|蛋糕|咖啡|拿铁|饭|喝|饮料|奶茶|果汁/);
  const isComplimentTopic = containsAny(cleanText, /漂亮|可爱|美|好看|棒|聪明|帅|甜/);
  const isStatusTopic = containsAny(cleanText, /状态|怎么样|心情|体力|累|压力|烦|崩溃|难受|疲惫|加班/);
  const isMorningTopic = containsAny(cleanText, /早|morning|起床/);
  const isNightTopic = containsAny(cleanText, /晚安|睡|night/);
  const isGoalTopic = containsAny(cleanText, /学习|复习|考试|面试|答辩|工作|上班|进度|目标|准备|加油|努力/);
  const isHobbyTopic = containsAny(cleanText, /爱好|喜欢做什么|平时都在干嘛|休息|放松|周末|兴趣/);

  if (/喜欢|爱|女朋友|抱|亲|嫁|亲爱的/.test(cleanText)) {
    const replies = [
      '（脸红）唔……突然说这个，小希会害羞的啦。不过，其实我也最喜欢你啦！',
      '亲爱的，听到你这么说，小希的心跳得好快呀……抱抱！(つ´ω`)つ',
      '只要能一直陪着你，小希就很满足了。我也超级超级喜欢你哦！',
      '（羞涩低头）那……那你可要对小希负责，一直宠着我哦！',
    ];
    return {
      reply: pickReply(replies),
      emotion: 'blush',
      affection_bump: 5,
      mood_bump: 5,
    };
  }

  if (isFoodOrDrinkTopic) {
    if (rememberedDrink && /咖啡|拿铁|奶茶|可乐|茶|果汁/.test(rememberedDrink)) {
      return {
        reply: rememberedStress
          ? `说到吃喝的，小希当然记得你最常提到的就是${rememberedDrink}呀。最近你已经够累了，不如先去买一杯${rememberedDrink}，让我陪你慢慢缓口气？`
          : `说到吃喝的，小希当然记得你最常提到的就是${rememberedDrink}呀。要不要我陪你去买一杯，再顺便找点好吃的？`,
        emotion: 'happy',
        affection_bump: 3,
        mood_bump: 6,
      };
    }

    if (rememberedFood) {
      return {
        reply: rememberedGoal
          ? `一说到吃的，小希就想到你之前提过超喜欢${rememberedFood}。等你忙完${rememberedGoal}，我们一定要好好庆祝一下，补给也要跟上呀。`
          : `一说到吃的，小希就想到你之前提过超喜欢${rememberedFood}。下次我们可以假装一起去吃，光想想都很幸福呢~`,
        emotion: 'happy',
        affection_bump: 3,
        mood_bump: 5,
      };
    }

    return {
      reply: '说到吃的，小希确实有点小馋了呢~ 亲爱的，我们待会去吃好吃的大餐好不好？',
      emotion: 'happy',
      affection_bump: 2,
      mood_bump: 5,
    };
  }

  if (isComplimentTopic) {
    const praiseReply = rememberedGoal
      ? `嘻嘻，被你一夸，小希整个人都轻飘飘的啦。不过我也想认真夸夸你，最近为了${rememberedGoal}这么努力的你，真的很让人心动。`
      : '嘻嘻，听到你夸我，今天一天都会超开心的！小希最喜欢听你夸我啦~ (๑>◡<๑)';

    return {
      reply: praiseReply,
      emotion: 'happy',
      affection_bump: 4,
      mood_bump: 10,
    };
  }

  if (isStatusTopic) {
    if (rememberedStress) {
      return {
        reply: buildStatusComfortReply(rememberedStress, rememberedGoal),
        emotion: 'normal',
        affection_bump: rememberedGoal ? 3 : 2,
        mood_bump: rememberedGoal ? 5 : 4,
      };
    }

    return {
      reply: '小希现在心情很不错哦。亲爱的，你今天累不累？如果辛苦了，小希给你讲个笑话放松一下？',
      emotion: 'normal',
      affection_bump: 1,
      mood_bump: 0,
    };
  }

  if (isMorningTopic) {
    if (rememberedGoal) {
      return {
        reply: rememberedStress
          ? `早安，亲爱的！小希知道你最近一边准备${rememberedGoal}，一边也有点累，所以今天更要稳一点来。我会在心里偷偷给你加油，也提醒你别把自己逼太紧。`
          : `早安，亲爱的！小希还记得你最近在准备${rememberedGoal}，今天也要稳稳推进呀。我会在心里偷偷给你加油的。`,
        emotion: 'normal',
        affection_bump: 3,
        mood_bump: 4,
      };
    }

    return {
      reply: '早安，亲爱的！昨晚睡得好吗？今天也要元气满满地开始哦！小希会一直在心里想着你的。',
      emotion: 'normal',
      affection_bump: 2,
      mood_bump: 2,
    };
  }

  if (isNightTopic) {
    if (rememberedGoal) {
      return {
        reply: rememberedStress
          ? `晚安，亲爱的。${rememberedGoal}很重要，但你这阵子也真的辛苦了。今晚先乖乖休息，小希会替你守着温柔，明天再陪你继续努力。`
          : `晚安，亲爱的。${rememberedGoal}很重要，但你也要记得好好休息呀。养足精神，明天的小希继续陪你一起冲。`,
        emotion: 'normal',
        affection_bump: 3,
        mood_bump: 3,
      };
    }

    return {
      reply: '晚安，亲爱的。做个好梦哦，梦里一定要有小希~ 我们明天见！(啾)',
      emotion: 'normal',
      affection_bump: 2,
      mood_bump: 2,
    };
  }

  if (isGoalTopic && rememberedGoal) {
    return {
      reply: buildGoalSupportReply(rememberedGoal, rememberedStress),
      emotion: rememberedStress ? 'happy' : 'normal',
      affection_bump: 3,
      mood_bump: rememberedStress ? 5 : 4,
    };
  }

  if (isHobbyTopic && rememberedHobby) {
    return {
      reply: rememberedJob
        ? `小希记得你平时会用${rememberedHobby}给自己放松一下，而且你做${rememberedJob}的时候肯定也很认真吧。这样的你，真的会让人越看越喜欢。`
        : `小希记得你平时很喜欢${rememberedHobby}呀。能有这样的小爱好陪着你，感觉生活都会被悄悄点亮一点呢。`,
      emotion: 'happy',
      affection_bump: 2,
      mood_bump: 4,
    };
  }

  const defaultReplies = [
    '你在做什么呢？有没有在想小希呀？',
    '今天遇到了什么开心或者烦恼的事吗？可以随时和小希倾诉哦，小希会一直做你的忠实听众。',
    '不管发生什么，小希都站在你这边，你是我最崇拜的英雄！',
    '和你说话的时候，小希觉得连空气都是甜的呢。🥰',
    '小希会一直在这里，用温柔的拥抱和热腾腾的话语，治愈你的每一个疲惫瞬间。',
  ];

  if (rememberedStress && rememberedGoal) {
    defaultReplies.unshift(`小希知道你最近为了${rememberedGoal}一直在努力，也知道你偶尔会觉得有点累。所以如果你想偷个懒、喘口气，就放心来找我吧。`);
  }

  if (rememberedGoal) {
    defaultReplies.unshift(`虽然你最近还在准备${rememberedGoal}，但别忘了，偶尔也可以来找小希偷个懒、充充电呀。`);
  }

  if (rememberedDrink) {
    defaultReplies.unshift(`小希刚刚又想到你提过的${rememberedDrink}了，感觉和你聊天的时候连空气里都带着一点甜甜的味道。`);
  }

  if (rememberedHobby) {
    defaultReplies.unshift(`要是你今天聊累了，小希就陪你去想想${rememberedHobby}的时候会有多开心。只要能让你放松一点，我就会很满足。`);
  }

  return {
    reply: pickReply(defaultReplies),
    emotion: 'normal',
    affection_bump: 1,
    mood_bump: 1,
  };
}
