#!/usr/bin/env node
// One-shot MiniMax (海螺) voice cloning helper.
//
// Clones a voice from a short sample, then prints the voice_id to drop into
// backend/.env as MINIMAX_TTS_VOICE_ID — after that every /api/tts reply speaks
// in the cloned voice.
//
// Usage:
//   node scripts/minimax-clone-voice.mjs --file ./sample.mp3 --voice-id xiaoxiVoice01
//   node scripts/minimax-clone-voice.mjs --file ./sample.wav --voice-id xiaoxiVoice01 --preview "你好呀，我是小希"
//
// Sample audio: mp3/m4a/wav, 10s–5min, <20MB.
// voice_id rules: starts with a letter, letters+digits, length >= 8, globally unique.
//
// Reads MINIMAX_API_KEY / MINIMAX_TTS_HOST from the environment, falling back to
// backend/.env so it shares the server's config.

import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--file') out.file = argv[++i];
    else if (key === '--voice-id') out.voiceId = argv[++i];
    else if (key === '--preview') out.preview = argv[++i];
    else if (key === '--model') out.model = argv[++i];
  }
  return out;
}

// Minimal KEY=VALUE loader so the script needs no dotenv dependency.
async function loadEnvFile(path) {
  try {
    const raw = await readFile(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* no .env — rely on the real environment */ }
}

function mimeFor(name) {
  if (/\.wav$/i.test(name)) return 'audio/wav';
  if (/\.m4a$/i.test(name)) return 'audio/mp4';
  return 'audio/mpeg';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.voiceId) {
    console.error('Usage: node scripts/minimax-clone-voice.mjs --file <sample.mp3> --voice-id <id> [--preview "text"] [--model speech-02-turbo]');
    process.exit(2);
  }
  if (!/^[A-Za-z][A-Za-z0-9]{7,}$/.test(args.voiceId)) {
    console.error('voice-id must start with a letter, be letters+digits, length >= 8 (e.g. xiaoxiVoice01).');
    process.exit(2);
  }

  await loadEnvFile(join(HERE, '..', 'backend', '.env'));
  const apiKey = process.env.MINIMAX_API_KEY;
  const host = (process.env.MINIMAX_TTS_HOST || 'https://api.minimaxi.com').replace(/\/+$/, '');
  if (!apiKey) {
    console.error('MINIMAX_API_KEY is not set (env or backend/.env).');
    process.exit(1);
  }

  // 1) Upload the sample → file_id.
  const bytes = await readFile(args.file);
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append('file', new Blob([bytes], { type: mimeFor(args.file) }), basename(args.file));

  console.log(`Uploading ${args.file} ...`);
  const upRes = await fetch(`${host}/v1/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const upJson = await upRes.json();
  const fileId = upJson?.file?.file_id ?? upJson?.file_id;
  if (!fileId) {
    console.error('Upload failed:', JSON.stringify(upJson, null, 2));
    process.exit(1);
  }
  console.log('Uploaded. file_id =', fileId);

  // 2) Clone → bind the sample to our custom voice_id.
  const body = { file_id: fileId, voice_id: args.voiceId };
  if (args.preview) {
    body.text = args.preview;
    body.model = args.model || 'speech-02-turbo';
  }
  console.log(`Cloning into voice_id "${args.voiceId}" ...`);
  const cloneRes = await fetch(`${host}/v1/voice_clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const cloneJson = await cloneRes.json();
  const status = cloneJson?.base_resp?.status_code;
  if (status !== 0) {
    console.error('Clone failed:', JSON.stringify(cloneJson, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Voice cloned successfully.');
  console.log('   Put this in backend/.env to make 小希 speak in it:\n');
  console.log(`   MINIMAX_TTS_VOICE_ID=${args.voiceId}\n`);
  if (cloneJson?.demo_audio) console.log('   Preview audio URL (valid ~hours):', cloneJson.demo_audio);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
