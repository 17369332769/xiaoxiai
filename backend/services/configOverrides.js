import { dbAll, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { createLogger } from '../core/logger.js';
import {
  FOOD_ITEMS as FOOD_LIST,
  GIFT_ITEMS as GIFT_LIST,
  TIPPING_TIERS as TIP_LIST,
} from '../../shared/gameConfig.js';
import { DAILY_TASKS, GROWTH_TASKS, DEFAULT_TASKS } from '../config/gameConfig.js';

const logger = createLogger('config-overrides');

// Operator-writable runtime overrides for hard-coded gameplay config. Supported
// override keys (validated strictly so a typo can't create a dead entry):
//   food:<id>:cost          shop food price
//   gift:<id>:cost          shop gift price
//   tippingTier:<amount>:coins  coins granted for a tipping tier
//   task:<id>:reward        coins awarded for completing a task
// Values must be positive integers within sane bounds. Stored in config_overrides
// and held in an in-memory cache so the hot purchase path stays synchronous; the
// cache is loaded once at startup and refreshed on every admin write.
const VALUE_MAX = 1_000_000;

const baseFood = new Map(FOOD_LIST.map((i) => [String(i.id), i]));
const baseGift = new Map(GIFT_LIST.map((i) => [String(i.id), i]));
const baseTip = new Map(TIP_LIST.map((t) => [String(t.amount), t]));
const baseTask = new Map(DEFAULT_TASKS.map((t) => [String(t.id), t]));

// key -> integer value
let cache = new Map();

// Parse a raw override key into a validated descriptor, or throw an AppError.
function parseOverrideKey(key) {
  const parts = String(key).split(':');
  if (parts.length !== 3) {
    throw new AppError(400, 'INVALID_OVERRIDE_KEY', `无法识别的配置项：${key}`);
  }
  const [section, id, field] = parts;
  if (section === 'food' && field === 'cost' && baseFood.has(id)) return { section, id, field };
  if (section === 'gift' && field === 'cost' && baseGift.has(id)) return { section, id, field };
  if (section === 'tippingTier' && field === 'coins' && baseTip.has(id)) return { section, id, field };
  if (section === 'task' && field === 'reward' && baseTask.has(id)) return { section, id, field };
  throw new AppError(400, 'INVALID_OVERRIDE_KEY', `不支持或不存在的配置项：${key}`);
}

function parseOverrideValue(value, key) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > VALUE_MAX) {
    throw new AppError(400, 'INVALID_OVERRIDE_VALUE', `配置项 ${key} 的值必须是 1–${VALUE_MAX} 的整数`);
  }
  return n;
}

// Load persisted overrides into the cache. Best-effort: a load failure leaves the
// cache empty (callers transparently fall back to base config).
export async function loadConfigOverrides() {
  try {
    const rows = await dbAll('SELECT key, value FROM config_overrides', []);
    const next = new Map();
    for (const row of rows) {
      const n = parseInt(row.value, 10);
      if (Number.isFinite(n)) next.set(row.key, n);
    }
    cache = next;
  } catch (error) {
    logger.warn('Failed to load config overrides; using base config', { error: error.message });
  }
  return cache;
}

// Apply overrides to one base record, returning plain objects with the overridden
// field replaced. Never mutates the base.
function effectiveRecord(baseMap, section, field) {
  const out = {};
  for (const [id, item] of baseMap) {
    const overrideKey = `${section}:${id}:${field}`;
    const override = cache.get(overrideKey);
    out[id] = override !== undefined ? { ...item, [field]: override } : { ...item };
  }
  return out;
}

export function getEffectiveFood() {
  return effectiveRecord(baseFood, 'food', 'cost');
}

export function getEffectiveGifts() {
  return effectiveRecord(baseGift, 'gift', 'cost');
}

export function getEffectiveTippingTiers() {
  return effectiveRecord(baseTip, 'tippingTier', 'coins');
}

// Apply task-reward overrides to a list of task definitions. Never mutates base.
function applyTaskRewards(list) {
  return list.map((task) => {
    const override = cache.get(`task:${task.id}:reward`);
    return override !== undefined ? { ...task, reward: override } : { ...task };
  });
}

// Effective task catalog (rewards overridden). Used to seed per-user task rows
// so an operator's reward change takes effect on each user's next sync — the
// seed upsert refreshes the stored reward — mirroring the shop-price overrides.
export function getEffectiveTasks() {
  return applyTaskRewards(DEFAULT_TASKS);
}

// Full snapshot for the admin console, with all operator overrides applied.
export function getConfigSnapshot() {
  return {
    food: Object.values(getEffectiveFood()),
    gifts: Object.values(getEffectiveGifts()),
    tippingTiers: Object.values(getEffectiveTippingTiers()),
    dailyTasks: applyTaskRewards(DAILY_TASKS),
    growthTasks: applyTaskRewards(GROWTH_TASKS),
  };
}

// Validate + persist a batch of overrides, refresh the cache, and return the
// applied changes as { key: { from, to } }. Throws AppError on any invalid entry
// (all-or-nothing: nothing is written if validation fails).
export async function applyConfigOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new AppError(400, 'INVALID_PARAMETER', 'overrides 必须是对象');
  }
  const entries = Object.entries(overrides);
  if (entries.length === 0) {
    throw new AppError(400, 'INVALID_PARAMETER', 'overrides 不能为空');
  }
  // Validate everything first so a bad entry doesn't leave a half-applied batch.
  const validated = entries.map(([key, rawValue]) => {
    parseOverrideKey(key);
    return { key, value: parseOverrideValue(rawValue, key) };
  });

  const applied = {};
  for (const { key, value } of validated) {
    const from = cache.get(key);
    await dbRun(
      `INSERT INTO config_overrides (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, String(value)]
    );
    applied[key] = { from: from ?? null, to: value };
  }
  await loadConfigOverrides();
  return applied;
}
