import { createLogger } from './logger.js';

// MiniMax (海螺) text-to-speech via the synchronous T2A v2 API.
//
// Confirmed contract (api.minimaxi.com, no GroupId needed):
//   POST <host>/v1/t2a_v2            Authorization: Bearer <apiKey>
//     body: { model, text, stream:false, voice_setting:{voice_id,speed,vol,pitch},
//             audio_setting:{sample_rate,bitrate,format}, language_boost }
//   -> { data:{ audio:<hex-encoded bytes> }, base_resp:{ status_code, status_msg }, extra_info }
//   status_code 0 == success. We hex-decode `data.audio` and return it as a base64
//   data: URI the browser plays directly (the API returns inline audio, not a URL).
//
// Measured ~1s round-trip with speech-02-turbo (vs the old RunningHub ~80s workflow).
//
// Voice cloning: a cloned voice produces a custom voice_id. Create one once with
// scripts/minimax-clone-voice.mjs, then point MINIMAX_TTS_VOICE_ID at it. Until
// then it falls back to a built-in system voice (female-tianmei, 甜美女声).
//
// Env:
//   MINIMAX_API_KEY            account key (Bearer)
//   MINIMAX_TTS_HOST           API host (default https://api.minimaxi.com)
//   MINIMAX_TTS_MODEL          speech-02-turbo | speech-2.6-hd | speech-2.8-hd | ...
//   MINIMAX_TTS_VOICE_ID       system voice OR a cloned voice id (default female-tianmei)
//   MINIMAX_TTS_SPEED          0.5–2 (default 1)
//   MINIMAX_TTS_VOL            >0–10 (default 1)
//   MINIMAX_TTS_PITCH          -12–12 (default 0)
//   MINIMAX_TTS_EMOTION        happy|sad|angry|fearful|disgusted|surprised|neutral (optional)
//   MINIMAX_TTS_FORMAT         mp3 | wav | pcm | flac (default mp3)
//   MINIMAX_TTS_SAMPLE_RATE    default 32000
//   MINIMAX_TTS_BITRATE        default 128000
//   MINIMAX_TTS_LANGUAGE_BOOST language hint, default Chinese

const logger = createLogger('tts');

const MIME_BY_FORMAT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pcm: 'audio/L16',
};

function ttsConfig() {
  const num = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    apiKey: process.env.MINIMAX_API_KEY || '',
    host: (process.env.MINIMAX_TTS_HOST || 'https://api.minimaxi.com').replace(/\/+$/, ''),
    model: process.env.MINIMAX_TTS_MODEL || 'speech-02-turbo',
    voiceId: process.env.MINIMAX_TTS_VOICE_ID || 'female-tianmei',
    speed: num(process.env.MINIMAX_TTS_SPEED, 1),
    vol: num(process.env.MINIMAX_TTS_VOL, 1),
    pitch: num(process.env.MINIMAX_TTS_PITCH, 0),
    emotion: (process.env.MINIMAX_TTS_EMOTION || '').trim(),
    format: (process.env.MINIMAX_TTS_FORMAT || 'mp3').toLowerCase(),
    sampleRate: num(process.env.MINIMAX_TTS_SAMPLE_RATE, 32000),
    bitrate: num(process.env.MINIMAX_TTS_BITRATE, 128000),
    languageBoost: process.env.MINIMAX_TTS_LANGUAGE_BOOST || 'Chinese',
  };
}

// The key alone is enough to call the synchronous endpoint.
export function isTtsEnabled() {
  return Boolean(ttsConfig().apiKey);
}

// Synthesize speech for `text`. Returns { ok:true, audioUrl } or { ok:false, error }.
// Never throws — callers degrade to text-only on failure. `audioUrl` is a base64
// data: URI (the API returns inline audio bytes, not a hosted URL).
export async function synthesizeSpeech(text, { requestTimeoutMs = 20000 } = {}) {
  const cfg = ttsConfig();
  if (!isTtsEnabled()) return { ok: false, error: 'TTS_NOT_CONFIGURED' };
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, error: 'EMPTY_TEXT' };

  const voiceSetting = { voice_id: cfg.voiceId, speed: cfg.speed, vol: cfg.vol, pitch: cfg.pitch };
  if (cfg.emotion) voiceSetting.emotion = cfg.emotion;

  const body = {
    model: cfg.model,
    text: clean,
    stream: false,
    language_boost: cfg.languageBoost,
    voice_setting: voiceSetting,
    audio_setting: { sample_rate: cfg.sampleRate, bitrate: cfg.bitrate, format: cfg.format },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${cfg.host}/v1/t2a_v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json();

    const status = payload?.base_resp?.status_code;
    if (status !== 0) {
      return { ok: false, error: payload?.base_resp?.status_msg || `STATUS_${status ?? 'UNKNOWN'}` };
    }
    const hex = payload?.data?.audio;
    if (!hex || typeof hex !== 'string') return { ok: false, error: 'NO_AUDIO_OUTPUT' };

    const base64 = Buffer.from(hex, 'hex').toString('base64');
    const mime = MIME_BY_FORMAT[cfg.format] || 'audio/mpeg';
    return { ok: true, audioUrl: `data:${mime};base64,${base64}` };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'TTS_TIMEOUT' : error.message;
    logger.warn('MiniMax TTS error', { error: reason });
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
