import { dbAll, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { createLogger } from '../core/logger.js';
import {
  FOOD_ITEMS as FOOD_SEED,
  GIFT_ITEMS as GIFT_SEED,
  DAILY_TASKS as DAILY_SEED,
  GROWTH_TASKS as GROWTH_SEED,
} from '../../shared/gameConfig.js';

const logger = createLogger('catalog');

// Dynamic, operator-editable catalog for shop items (food / gifts) and task
// templates. The DB tables are the source of truth at runtime, seeded once from
// the shared/gameConfig defaults. The in-memory lists below DEFAULT to those same
// static seeds synchronously, so any code path that reads the catalog before
// loadCatalog() has run (e.g. a test that never boots the full server) behaves
// exactly as the old static config did — loadCatalog() then overlays the DB rows.
let foodList = FOOD_SEED.map((item) => ({ ...item }));
let giftList = GIFT_SEED.map((item) => ({ ...item }));
let taskList = [...DAILY_SEED, ...GROWTH_SEED].map((task) => ({ ...task }));

const TASK_SEED = [...DAILY_SEED, ...GROWTH_SEED];
const VALUE_MAX = 1_000_000;

export function getFoodList() {
  return foodList;
}

export function getGiftList() {
  return giftList;
}

export function getTaskList() {
  return taskList;
}

export function getDailyTasks() {
  return taskList.filter((t) => (t.category || 'daily') === 'daily');
}

export function getGrowthTasks() {
  return taskList.filter((t) => t.category === 'growth');
}

// Seed the catalog tables from the static defaults. INSERT OR IGNORE keeps it
// idempotent and non-destructive: it only fills an empty/new table and never
// overwrites operator edits on restart.
export async function seedCatalog() {
  try {
    for (let i = 0; i < FOOD_SEED.length; i += 1) {
      const it = FOOD_SEED[i];
      await dbRun(
        `INSERT OR IGNORE INTO food_catalog (id, name, cost, energy, affection, icon, description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [it.id, it.name, it.cost, it.energy, it.affection, it.icon, it.desc, i]
      );
    }
    for (let i = 0; i < GIFT_SEED.length; i += 1) {
      const it = GIFT_SEED[i];
      await dbRun(
        `INSERT OR IGNORE INTO gift_catalog (id, name, cost, mood, affection, icon, description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [it.id, it.name, it.cost, it.mood, it.affection, it.icon, it.desc, i]
      );
    }
    for (let i = 0; i < TASK_SEED.length; i += 1) {
      const t = TASK_SEED[i];
      await dbRun(
        `INSERT OR IGNORE INTO task_catalog (id, name, target, reward, category, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.id, t.name, t.target, t.reward, t.category, i]
      );
    }
  } catch (error) {
    logger.warn('Failed to seed catalog; keeping static defaults', { error: error.message });
  }
}

function mapFoodRow(row) {
  return { id: row.id, name: row.name, cost: row.cost, energy: row.energy, affection: row.affection, icon: row.icon, desc: row.description };
}
function mapGiftRow(row) {
  return { id: row.id, name: row.name, cost: row.cost, mood: row.mood, affection: row.affection, icon: row.icon, desc: row.description };
}
function mapTaskRow(row) {
  return { id: row.id, name: row.name, target: row.target, reward: row.reward, category: row.category };
}

// Load active catalog rows into the in-memory lists. A load failure (or an empty
// table) leaves the static-default lists in place, so the catalog never goes dark.
export async function loadCatalog() {
  try {
    const [foods, gifts, tasks] = await Promise.all([
      dbAll('SELECT * FROM food_catalog WHERE is_active = 1 ORDER BY sort_order, rowid', []),
      dbAll('SELECT * FROM gift_catalog WHERE is_active = 1 ORDER BY sort_order, rowid', []),
      dbAll('SELECT * FROM task_catalog WHERE is_active = 1 ORDER BY sort_order, rowid', []),
    ]);
    if (foods.length) foodList = foods.map(mapFoodRow);
    if (gifts.length) giftList = gifts.map(mapGiftRow);
    if (tasks.length) taskList = tasks.map(mapTaskRow);
  } catch (error) {
    logger.warn('Failed to load catalog; keeping current lists', { error: error.message });
  }
  return { food: foodList, gifts: giftList, tasks: taskList };
}

// ---- Validation helpers ----------------------------------------------------
function reqId(item) {
  const id = String(item?.id || '').trim();
  if (!/^[a-zA-Z0-9_]{1,40}$/.test(id)) {
    throw new AppError(400, 'INVALID_CATALOG_ITEM', 'id 必须是 1–40 位字母/数字/下划线');
  }
  return id;
}
function reqInt(value, field, { min = 0 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > VALUE_MAX) {
    throw new AppError(400, 'INVALID_CATALOG_ITEM', `${field} 必须是 ${min}–${VALUE_MAX} 的整数`);
  }
  return n;
}
function reqStr(value, field, max = 80) {
  const s = String(value ?? '').trim();
  if (!s || s.length > max) {
    throw new AppError(400, 'INVALID_CATALOG_ITEM', `${field} 不能为空且不超过 ${max} 字`);
  }
  return s;
}

// ---- CRUD (admin) ----------------------------------------------------------
export async function upsertCatalogItem(kind, item) {
  if (kind === 'food') {
    const id = reqId(item);
    await dbRun(
      `INSERT INTO food_catalog (id, name, cost, energy, affection, icon, description, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, cost=excluded.cost, energy=excluded.energy,
         affection=excluded.affection, icon=excluded.icon, description=excluded.description,
         sort_order=excluded.sort_order, is_active=1`,
      [id, reqStr(item.name), reqInt(item.cost, 'cost', { min: 1 }), reqInt(item.energy, 'energy'),
        reqInt(item.affection, 'affection'), reqStr(item.icon, 'icon', 8), reqStr(item.desc, 'desc', 200),
        reqInt(item.sortOrder ?? 99, 'sortOrder')]
    );
  } else if (kind === 'gift') {
    const id = reqId(item);
    await dbRun(
      `INSERT INTO gift_catalog (id, name, cost, mood, affection, icon, description, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, cost=excluded.cost, mood=excluded.mood,
         affection=excluded.affection, icon=excluded.icon, description=excluded.description,
         sort_order=excluded.sort_order, is_active=1`,
      [id, reqStr(item.name), reqInt(item.cost, 'cost', { min: 1 }), reqInt(item.mood, 'mood'),
        reqInt(item.affection, 'affection'), reqStr(item.icon, 'icon', 8), reqStr(item.desc, 'desc', 200),
        reqInt(item.sortOrder ?? 99, 'sortOrder')]
    );
  } else if (kind === 'task') {
    const id = reqId(item);
    const category = item.category === 'growth' ? 'growth' : 'daily';
    await dbRun(
      `INSERT INTO task_catalog (id, name, target, reward, category, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, target=excluded.target, reward=excluded.reward,
         category=excluded.category, sort_order=excluded.sort_order, is_active=1`,
      [id, reqStr(item.name), reqInt(item.target, 'target', { min: 1 }), reqInt(item.reward, 'reward', { min: 1 }),
        category, reqInt(item.sortOrder ?? 99, 'sortOrder')]
    );
  } else {
    throw new AppError(400, 'INVALID_PARAMETER', `未知的目录类型：${kind}`);
  }
  await loadCatalog();
  return true;
}

export async function deleteCatalogItem(kind, id) {
  const table = kind === 'food' ? 'food_catalog' : kind === 'gift' ? 'gift_catalog' : kind === 'task' ? 'task_catalog' : null;
  if (!table) throw new AppError(400, 'INVALID_PARAMETER', `未知的目录类型：${kind}`);
  const safeId = String(id || '').trim();
  if (!safeId) throw new AppError(400, 'INVALID_PARAMETER', 'id 不能为空');
  const result = await dbRun(`DELETE FROM ${table} WHERE id = ?`, [safeId]);
  await loadCatalog();
  return result.changes > 0;
}
