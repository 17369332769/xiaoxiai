import { AppError } from './appError.js';
import { asyncHandler, sendJson } from './httpUtils.js';
import { checkContentSafety } from './contentSafety.js';
import { isTtsEnabled, synthesizeSpeech } from './tts.js';

// On-demand text-to-speech for a chat reply. Authenticated (resolveUser) since
// synthesis is a paid MiniMax call we don't want abused anonymously.
// Returns { audioUrl } (a base64 data: URI) the client can play.
export function registerTtsRoutes(app, { resolveUser }) {
  app.use('/api/tts', resolveUser);

  app.post('/api/tts', asyncHandler(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw new AppError(400, 'INVALID_TEXT', 'text is required');
    if (text.length > 500) throw new AppError(400, 'TEXT_TOO_LONG', 'text must be 500 characters or fewer');

    if (!isTtsEnabled()) {
      throw new AppError(503, 'TTS_DISABLED', '语音合成未配置（需要 MINIMAX_API_KEY）');
    }

    // Screen the text we're about to voice with the same content filter.
    const safety = checkContentSafety(text);
    if (!safety.safe) {
      throw new AppError(400, 'CONTENT_BLOCKED', '该内容不适合合成语音');
    }

    const result = await synthesizeSpeech(text);
    if (!result.ok) {
      throw new AppError(502, 'TTS_FAILED', `语音合成失败：${result.error}`);
    }

    sendJson(res, { audioUrl: result.audioUrl });
  }));
}
