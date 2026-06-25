import { asyncHandler, sendJson } from './httpUtils.js';
import { THEMES } from '../shared/gameConfig.js';
import { getUserThemeState, unlockUserTheme, equipUserTheme } from './themeStore.js';

// Cosmetic theme system: list the catalog + the user's owned/equipped state,
// unlock a theme with coins, or equip an owned one. All behind resolveUser so a
// bound account is enforced via token while guests still play.
export function registerThemeRoutes(app, { resolveUser, presence }) {
  app.use('/api/themes', resolveUser);

  app.post('/api/themes', asyncHandler(async (req, res) => {
    const state = await getUserThemeState(req.userId);
    sendJson(res, { catalog: THEMES, ...state });
  }));

  app.post('/api/themes/unlock', asyncHandler(async (req, res) => {
    if (presence) presence.touch(req.userId);
    const result = await unlockUserTheme(req.userId, req.body?.themeId);
    sendJson(res, result);
  }));

  app.post('/api/themes/equip', asyncHandler(async (req, res) => {
    const state = await equipUserTheme(req.userId, req.body?.themeId);
    sendJson(res, state);
  }));
}
