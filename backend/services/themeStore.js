import { dbAll, dbGet, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { THEMES, FREE_THEME_IDS, DEFAULT_THEME_ID, getThemeById } from '../../shared/gameConfig.js';
import { debitCoins, recordTransaction, refundCoins } from './gameplay.js';

// Owned theme ids = free themes (implicitly owned by everyone) ∪ rows in
// user_themes (purchased). Free themes are never stored.
async function getOwnedThemeIds(userId) {
  const rows = await dbAll('SELECT theme_id FROM user_themes WHERE user_id = ?', [userId]);
  const owned = new Set(FREE_THEME_IDS);
  for (const row of rows) owned.add(row.theme_id);
  return [...owned];
}

// Current theme state for a user: which themes they own and which is equipped.
// Never reports an equipped theme the user doesn't own (defensive fallback).
export async function getUserThemeState(userId) {
  const user = await dbGet('SELECT equipped_theme FROM users WHERE id = ?', [userId]);
  const owned = await getOwnedThemeIds(userId);
  let equipped = user && user.equipped_theme ? user.equipped_theme : DEFAULT_THEME_ID;
  if (!owned.includes(equipped)) equipped = DEFAULT_THEME_ID;
  return { owned, equipped };
}

// Purchase a theme with coins (atomic debit + ledger), then equip it. Throws
// AppError on invalid/owned/free theme or insufficient coins.
export async function unlockUserTheme(userId, themeId) {
  const theme = getThemeById(themeId);
  if (!theme) throw new AppError(400, 'INVALID_THEME', '主题不存在');
  if (theme.cost <= 0) throw new AppError(400, 'THEME_FREE', '该主题无需解锁');

  const owned = await getOwnedThemeIds(userId);
  if (owned.includes(themeId)) throw new AppError(409, 'THEME_OWNED', '你已经拥有该主题');

  const user = await dbGet('SELECT coins FROM users WHERE id = ?', [userId]);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (user.coins < theme.cost) throw new AppError(400, 'INSUFFICIENT_COINS', '爱心币不足');

  const debit = await debitCoins(userId, theme.cost);
  if (!debit.ok) throw new AppError(400, 'INSUFFICIENT_COINS', '爱心币不足');

  // The INSERT is the real gate against a concurrent double-unlock: if another
  // request already inserted this theme (changes === 0), refund the debit so the
  // player is never charged twice for one cosmetic.
  const insert = await dbRun('INSERT OR IGNORE INTO user_themes (user_id, theme_id) VALUES (?, ?)', [userId, themeId]);
  if (!insert.changes) {
    await refundCoins(userId, theme.cost);
    throw new AppError(409, 'THEME_OWNED', '你已经拥有该主题');
  }
  await recordTransaction(userId, {
    type: 'spend',
    category: 'theme',
    amount: theme.cost,
    balance: debit.balance,
    description: `解锁主题 ${theme.name}`,
  });
  // Unlocking equips it immediately (fewer clicks for the player).
  await dbRun('UPDATE users SET equipped_theme = ? WHERE id = ?', [themeId, userId]);

  const state = await getUserThemeState(userId);
  return { ...state, coins: debit.balance };
}

// Equip an already-owned theme (or a free one). Throws if not owned.
export async function equipUserTheme(userId, themeId) {
  if (!getThemeById(themeId)) throw new AppError(400, 'INVALID_THEME', '主题不存在');
  const owned = await getOwnedThemeIds(userId);
  if (!owned.includes(themeId)) throw new AppError(403, 'THEME_NOT_OWNED', '请先解锁该主题');
  await dbRun('UPDATE users SET equipped_theme = ? WHERE id = ?', [themeId, userId]);
  return getUserThemeState(userId);
}

export { THEMES };
