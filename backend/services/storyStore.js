// Story ("剧情") domain logic. Episodes unlock by relationship level and, the first
// time read to the end, grant a one-time coin reward plus the affection earned from
// the player's choices. Mirrors themeStore (catalog in shared/gameConfig.js, per-user
// rows in user_story_progress) but the gate is the user's level, not a coin purchase.

import { dbAll, dbGet, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { createLogger } from '../core/logger.js';
import { STORIES, getStoryById } from '../../shared/gameConfig.js';
import { creditCoins, recordTransaction, addAffection } from './gameplay.js';

const logger = createLogger('story');

// Story ids the user has already read to completion.
async function getReadStoryIds(userId) {
  const rows = await dbAll('SELECT story_id FROM user_story_progress WHERE user_id = ?', [userId]);
  return rows.map((row) => row.story_id);
}

// The user-facing story state: which episodes are read, and the current level the
// client uses to compute locked/unlocked. Catalog itself is static (from config).
export async function getUserStoryState(userId) {
  const user = await dbGet('SELECT level FROM users WHERE id = ?', [userId]);
  const read = await getReadStoryIds(userId);
  return { read, level: user ? user.level : 1 };
}

// The minimal user snapshot the client applies after a claim (matches the sync /
// action shape consumed by applyUserSnapshot).
async function userSnapshot(userId) {
  const u = await dbGet('SELECT level, affection, energy, mood, coins FROM users WHERE id = ?', [userId]);
  return u ? { level: u.level, affection: u.affection, energy: u.energy, mood: u.mood, coins: u.coins } : null;
}

// Sum the affection from the player's chosen options, validating each pick against
// the episode's catalog. Out-of-range / non-choice indices are ignored, and the
// values come from the static catalog (not the request body), so a client can't
// inflate the reward — at worst it picks the warmest option this episode offers.
function affectionFromChoices(story, choices) {
  if (!Array.isArray(choices)) return 0;
  let total = 0;
  for (const pick of choices) {
    const scene = story.scenes[pick?.scene];
    if (!scene || scene.who !== 'choice' || !Array.isArray(scene.options)) continue;
    const option = scene.options[pick?.option];
    if (option && Number.isFinite(option.affection)) {
      total += Math.max(0, option.affection);
    }
  }
  return total;
}

// Mark a story read. The first completion (INSERT actually inserts) grants the
// coin reward + the affection from `choices`; a repeat read is idempotent and grants
// nothing (rewarded:false). Gated on level so a client can't claim a locked episode.
export async function claimStory(userId, storyId, choices) {
  const story = getStoryById(storyId);
  if (!story) throw new AppError(400, 'INVALID_STORY', '剧情不存在');

  const user = await dbGet('SELECT level, affection, energy, mood, coins FROM users WHERE id = ?', [userId]);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (user.level < story.requiredLevel) {
    throw new AppError(403, 'STORY_LOCKED', `这段剧情要羁绊等级 Lv.${story.requiredLevel} 才能解锁哦`);
  }

  // INSERT OR IGNORE is the reward gate: changes===1 means this is the first read,
  // so the reward is granted exactly once even under concurrent claims.
  const insert = await dbRun(
    'INSERT OR IGNORE INTO user_story_progress (user_id, story_id) VALUES (?, ?)',
    [userId, storyId]
  );

  // Repeat read (or a concurrent loser): no credit, just the current state.
  if (!insert.changes) {
    const state = await getUserStoryState(userId);
    return { ...state, rewarded: false, user: await userSnapshot(userId), systemMessages: [] };
  }

  // First completion: grant the coin reward, then the affection from the choices.
  const rewardCoins = (story.reward && story.reward.coins) || 0;
  if (rewardCoins > 0) {
    const balance = await creditCoins(userId, rewardCoins);
    // creditCoins returns null only if the user row vanished mid-request (e.g. a
    // concurrent account deletion). Bail before writing a null-balance ledger row.
    if (!Number.isFinite(balance)) {
      throw new AppError(500, 'STORY_REWARD_FAILED', '奖励发放失败，请稍后再试');
    }
    await recordTransaction(userId, {
      type: 'earn',
      category: 'story_reward',
      amount: rewardCoins,
      balance,
      description: `读完剧情《${story.title}》奖励`,
    });
  }

  let affectionGain = affectionFromChoices(story, choices);
  let systemMessages = [];
  if (affectionGain > 0) {
    try {
      const aff = await addAffection(userId, user, affectionGain);
      systemMessages = aff.systemMessages || [];
    } catch (error) {
      // Coins (the source of truth) are already granted; the affection bonus is
      // best-effort. Don't fail the whole claim — that would mislead the client into
      // thinking nothing was granted. Log it and report no affection applied.
      logger.warn('story affection grant failed', { userId, storyId, error: error.message });
      affectionGain = 0;
    }
  }

  const state = await getUserStoryState(userId);
  return {
    ...state,
    rewarded: true,
    reward: { coins: rewardCoins, affection: affectionGain },
    user: await userSnapshot(userId),
    systemMessages,
  };
}

export { STORIES };
