import { asyncHandler, sanitizeUserId, sendJson } from './httpUtils.js';
import { loadBroadcasts } from './broadcasts.js';

// Real online presence + real broadcast feed (replaces the old front-end random
// online count and locally-faked ticker).
export function registerCommunityRoutes(app, { presence }) {
  async function buildFeed(userId) {
    if (userId && presence) presence.touch(userId);
    const broadcasts = await loadBroadcasts(12);
    return {
      onlineCount: presence ? presence.displayCount() : 0,
      broadcasts,
    };
  }

  // Heartbeat: keeps the user marked online and returns the live feed.
  app.post('/api/presence', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    sendJson(res, await buildFeed(userId));
  }));

  // Read-only feed fetch (userId optional).
  app.post('/api/broadcasts', asyncHandler(async (req, res) => {
    const userId = typeof req.body?.userId === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(req.body.userId.trim())
      ? req.body.userId.trim()
      : null;
    sendJson(res, await buildFeed(userId));
  }));
}
