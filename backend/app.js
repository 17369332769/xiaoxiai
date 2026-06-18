import express from 'express';
import { createErrorHandler, applyCommonMiddleware } from './middleware.js';
import { registerApiRoutes } from './apiRoutes.js';

export function createApp({ logger, openai, allowedOrigin, rateLimitWindowMs, rateLimitMaxRequests }) {
  const app = express();

  applyCommonMiddleware(app, {
    allowedOrigin,
    rateLimitWindowMs,
    rateLimitMaxRequests,
  });

  registerApiRoutes(app, { openai, logger });
  app.use(createErrorHandler(logger));

  return app;
}
