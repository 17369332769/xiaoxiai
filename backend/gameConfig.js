import {
  CHECKIN_STREAK_REWARDS,
  DAILY_TASKS,
  DAILY_TASK_IDS,
  DEFAULT_TASKS,
  FOOD_ITEMS as FOOD_ITEM_LIST,
  GIFT_ITEMS as GIFT_ITEM_LIST,
  GROWTH_TASKS,
  GROWTH_TASK_IDS,
  RELATIONSHIP_TIERS,
  TASK_IDS,
  TIPPING_TIERS as TIPPING_TIER_LIST,
  getCheckinStreakReward,
  getRelationshipTier,
} from '../shared/gameConfig.js';

function toRecord(items, keyField) {
  return Object.fromEntries(items.map((item) => [String(item[keyField]), item]));
}

export {
  CHECKIN_STREAK_REWARDS,
  DAILY_TASKS,
  DAILY_TASK_IDS,
  DEFAULT_TASKS,
  GROWTH_TASKS,
  GROWTH_TASK_IDS,
  RELATIONSHIP_TIERS,
  TASK_IDS,
  getCheckinStreakReward,
  getRelationshipTier,
};

export const FOOD_ITEMS = toRecord(FOOD_ITEM_LIST, 'id');
export const GIFT_ITEMS = toRecord(GIFT_ITEM_LIST, 'id');
export const TIPPING_TIERS = toRecord(TIPPING_TIER_LIST, 'amount');
