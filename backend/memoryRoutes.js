import { dbGet } from './db.js';
import { AppError } from './appError.js';
import { asyncHandler, sanitizeUserId, sendJson } from './httpUtils.js';
import { clearMemories, deleteMemory, listMemories } from './memoryStore.js';

// Lets a user inspect and prune the long-term memories Xiaoxi keeps about them
// (manual cleanup + transparency for the memory system).
export function registerMemoryRoutes(app) {
  app.post('/api/memory/list', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const user = await dbGet('SELECT id, summary FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const memories = await listMemories(userId);
    sendJson(res, { summary: user.summary || '', memories });
  }));

  app.post('/api/memory/delete', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key) throw new AppError(400, 'INVALID_PARAMETER', 'memory key is required');

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const deleted = await deleteMemory(userId, key);
    if (!deleted) throw new AppError(404, 'MEMORY_NOT_FOUND', 'Memory not found');

    const memories = await listMemories(userId);
    sendJson(res, { memories });
  }));

  app.post('/api/memory/clear', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const cleared = await clearMemories(userId);
    sendJson(res, { cleared });
  }));
}
