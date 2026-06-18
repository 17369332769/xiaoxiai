import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { createOpenAiClient } from './aiRuntime.js';
import { createLogger, logConfig } from './logger.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10);
const logger = createLogger('server');

process.on('uncaughtException', (err) => {
  logger.error('CRITICAL: Uncaught exception', { error: err });
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('CRITICAL: Unhandled rejection', { promise, reason });
});

const openai = createOpenAiClient(logger);
const app = createApp({
  logger,
  openai,
  allowedOrigin: ALLOWED_ORIGIN,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
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
    });
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFilePath === process.argv[1]) {
  startServer();
}
