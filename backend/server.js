import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { createOpenAiClient } from './aiRuntime.js';
import { createLogger, logConfig } from './logger.js';
import { dbReady } from './db.js';
import { ensureSeedBroadcast } from './broadcasts.js';

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
const logger = createLogger('server');

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
});

// Seed a welcome broadcast once the database is ready (best-effort).
dbReady.then(() => ensureSeedBroadcast()).catch((error) => {
  logger.warn('Failed to seed default broadcast', { error: error.message });
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
