import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { createOpenAiClient } from './services/ai/aiRuntime.js';
import { createLogger, logConfig } from './core/logger.js';
import { dbReady } from './core/db.js';
import { ensureSeedBroadcast } from './services/broadcasts.js';
import { startBackupSchedule } from './services/backup.js';
import { loadConfigOverrides } from './services/configOverrides.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10);
// Secrets for the payment callback signature and the account auth token. Safe
// dev defaults keep local runs working; production must override them.
const PAYMENT_SECRET = process.env.PAYMENT_SECRET || 'xiaoxiai-dev-payment-secret';
const AUTH_SECRET = process.env.AUTH_SECRET || 'xiaoxiai-dev-auth-secret';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PRESENCE_BASELINE = parseInt(process.env.PRESENCE_BASELINE || '0', 10);
// Demo-only switch. When true, /api/action/tip instantly grants coins WITHOUT a
// real payment and /api/order/create hands the client a pre-signed gateway
// callback to replay. Both are self-service coin mints, so this MUST stay off in
// production (only a real gateway holding PAYMENT_SECRET should be able to settle).
// As defense-in-depth, it is force-disabled under NODE_ENV=production even if a
// stray .env requests it, so a copied dev env can never re-open the faucet.
const SIMULATED_PAYMENT_REQUESTED = String(process.env.ALLOW_SIMULATED_PAYMENT).toLowerCase() === 'true';
const ALLOW_SIMULATED_PAYMENT = SIMULATED_PAYMENT_REQUESTED && process.env.NODE_ENV !== 'production';
// Express 'trust proxy' setting. Default 'loopback' fits "Nginx on the same host
// proxies to 127.0.0.1". Override via TRUST_PROXY for other topologies:
//   - a hop count (e.g. 1 for a single upstream LB),
//   - true/false, or a preset/subnet string Express understands.
// Avoid `true` unless the edge strips client-supplied X-Forwarded-For.
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);
const logger = createLogger('server');

function parseTrustProxy(raw) {
  if (raw === undefined || raw.trim() === '') return 'loopback';
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && String(asNumber) === value) return asNumber;
  return value;
}

process.on('uncaughtException', (err) => {
  logger.error('CRITICAL: Uncaught exception', { error: err });
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('CRITICAL: Unhandled rejection', { promise, reason });
});

if (!process.env.ADMIN_TOKEN) {
  logger.warn('ADMIN_TOKEN is not set; the operator admin API is disabled');
}
if (!process.env.PAYMENT_SECRET || !process.env.AUTH_SECRET) {
  logger.warn('Using built-in dev secrets for PAYMENT_SECRET/AUTH_SECRET; set real values in production');
}
if (SIMULATED_PAYMENT_REQUESTED && !ALLOW_SIMULATED_PAYMENT) {
  logger.error('ALLOW_SIMULATED_PAYMENT was requested but is force-disabled under NODE_ENV=production. Coins are only granted via a real signed payment callback.');
} else if (ALLOW_SIMULATED_PAYMENT) {
  logger.warn('ALLOW_SIMULATED_PAYMENT is enabled; /api/action/tip and /api/order/create grant coins WITHOUT real payment. Do NOT enable in production.');
}

const openai = createOpenAiClient(logger);
const app = createApp({
  logger,
  openai,
  allowedOrigin: ALLOWED_ORIGIN,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
  paymentSecret: PAYMENT_SECRET,
  authSecret: AUTH_SECRET,
  adminToken: ADMIN_TOKEN,
  presenceBaseline: PRESENCE_BASELINE,
  allowSimulatedPayment: ALLOW_SIMULATED_PAYMENT,
  trustProxy: TRUST_PROXY,
});

// Once the database is ready: seed a welcome broadcast and arm scheduled backups
// (both best-effort; a failure here must not stop the server from serving).
dbReady.then(async () => {
  // Each step is independently best-effort: await with its own catch so one
  // failure can't leave an unhandled rejection or skip the others.
  await ensureSeedBroadcast().catch((error) => logger.warn('Failed to seed default broadcast', { error: error.message }));
  startBackupSchedule();
  await loadConfigOverrides().catch((error) => logger.warn('Failed to load config overrides', { error: error.message }));
}).catch((error) => {
  logger.warn('Post-startup init failed', { error: error.message });
});

export { app };

export function startServer(port = PORT) {
  return app.listen(port, () => {
    logger.info('Backend server started', {
      port,
      allowedOrigin: ALLOWED_ORIGIN,
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
      logLevel: logConfig.level,
      requestLoggingEnabled: logConfig.requestLoggingEnabled,
      adminEnabled: Boolean(ADMIN_TOKEN),
    });
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFilePath === process.argv[1]) {
  startServer();
}
