import { asyncHandler, sendJson } from '../core/httpUtils.js';
import { STORIES } from '../../shared/gameConfig.js';
import { getUserStoryState, claimStory } from '../services/storyStore.js';

// Story ("剧情") system: list the episode catalog + the user's read state/level,
// and claim an episode once it has been read to the end (grants its one-time
// reward). Behind resolveUser so a bound account is token-enforced while guests
// still play.
export function registerStoryRoutes(app, { resolveUser, presence }) {
  app.use('/api/stories', resolveUser);

  app.post('/api/stories', asyncHandler(async (req, res) => {
    const state = await getUserStoryState(req.userId);
    sendJson(res, { catalog: STORIES, ...state });
  }));

  app.post('/api/stories/claim', asyncHandler(async (req, res) => {
    if (presence) presence.touch(req.userId);
    const result = await claimStory(req.userId, req.body?.storyId, req.body?.choices);
    sendJson(res, result);
  }));
}
