import {
  DEFAULT_TASKS,
  FOOD_ITEMS as FOOD_ITEM_LIST,
  GIFT_ITEMS as GIFT_ITEM_LIST,
  TASK_IDS,
  TIPPING_TIERS as TIPPING_TIER_LIST,
} from '../shared/gameConfig.js';

function toRecord(items, keyField) {
  return Object.fromEntries(items.map((item) => [String(item[keyField]), item]));
}

export { DEFAULT_TASKS, TASK_IDS };

export const FOOD_ITEMS = toRecord(FOOD_ITEM_LIST, 'id');
export const GIFT_ITEMS = toRecord(GIFT_ITEM_LIST, 'id');
export const TIPPING_TIERS = toRecord(TIPPING_TIER_LIST, 'amount');
