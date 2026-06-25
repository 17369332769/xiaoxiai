import { dbGet } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { asyncHandler, sendJson } from '../core/httpUtils.js';
import { checkContentSafety } from '../services/contentSafety.js';
import {
  addMemory,
  clearMemories,
  deleteMemory,
  listMemories,
  updateMemory,
  MEMORY_VALUE_MAX_LENGTH,
} from '../services/memory/memoryStore.js';

// Lets a user inspect and prune the long-term memories Xiaoxi keeps about them
// (manual cleanup + transparency for the memory system).
export function registerMemoryRoutes(app, { resolveUser }) {
  app.use(['/api/memory'], resolveUser);

  app.post('/api/memory/list', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const user = await dbGet('SELECT id, summary FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const memories = await listMemories(userId);
    sendJson(res, { summary: user.summary || '', memories });
  }));

  // User actively teaches Xiaoxi a fact ("记住：我每天喝美式"). Optional `key`
  // (topic) lets the client target/overwrite a specific memory; otherwise a new
  // note is created. Screened by the same content filter as chat.
  app.post('/api/memory/add', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw new AppError(400, 'INVALID_PARAMETER', 'text is required');
    if (text.length > MEMORY_VALUE_MAX_LENGTH) {
      throw new AppError(400, 'TEXT_TOO_LONG', `内容请控制在 ${MEMORY_VALUE_MAX_LENGTH} 字以内`);
    }
    if (!checkContentSafety(text).safe) {
      throw new AppError(400, 'CONTENT_BLOCKED', '该内容不适合记录');
    }

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const rawKey = typeof req.body?.key === 'string' ? req.body.key : undefined;
    const key = await addMemory(userId, text, rawKey);
    if (!key) throw new AppError(400, 'INVALID_PARAMETER', '这条内容没法记下来呢');

    const memories = await listMemories(userId);
    sendJson(res, { memories });
  }));

  // Edit an existing memory's content in place (weight preserved).
  app.post('/api/memory/update', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!key) throw new AppError(400, 'INVALID_PARAMETER', 'memory key is required');
    if (!text) throw new AppError(400, 'INVALID_PARAMETER', 'text is required');
    if (text.length > MEMORY_VALUE_MAX_LENGTH) {
      throw new AppError(400, 'TEXT_TOO_LONG', `内容请控制在 ${MEMORY_VALUE_MAX_LENGTH} 字以内`);
    }
    if (!checkContentSafety(text).safe) {
      throw new AppError(400, 'CONTENT_BLOCKED', '该内容不适合记录');
    }

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const result = await updateMemory(userId, key, text);
    if (result === 'not_found') throw new AppError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
    if (result === 'invalid') throw new AppError(400, 'INVALID_PARAMETER', '这条内容没法保存呢');

    const memories = await listMemories(userId);
    sendJson(res, { memories });
  }));

  app.post('/api/memory/delete', asyncHandler(async (req, res) => {
    const userId = req.userId;
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
    const userId = req.userId;
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const cleared = await clearMemories(userId);
    sendJson(res, { cleared });
  }));
}
