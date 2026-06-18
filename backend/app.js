import express from 'express';
import { createErrorHandler, applyCommonMiddleware } from './middleware.js';
import { registerApiRoutes } from './apiRoutes.js';
import { registerOrderRoutes } from './orderRoutes.js';
import { registerAccountRoutes } from './accountRoutes.js';
import { registerCommunityRoutes } from './communityRoutes.js';
import { registerAnalyticsRoutes } from './analyticsRoutes.js';
import { registerMemoryRoutes } from './memoryRoutes.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { createPresenceTracker } from './presence.js';

export function createApp({
  logger,
  openai,
  allowedOrigin,
  rateLimitWindowMs,
  rateLimitMaxRequests,
  paymentSecret,
  authSecret,
  adminToken,
  presenceBaseline = 0,
}) {
  const app = express();

  applyCommonMiddleware(app, {
    allowedOrigin,
    rateLimitWindowMs,
    rateLimitMaxRequests,
  });

  const presence = createPresenceTracker({ ttlMs: 60000, baseline: presenceBaseline });
  app.locals.presence = presence;

  registerApiRoutes(app, { openai, logger, presence });
  registerOrderRoutes(app, { paymentSecret, presence, logger });
  registerAccountRoutes(app, { authSecret });
  registerCommunityRoutes(app, { presence });
  registerAnalyticsRoutes(app);
  registerMemoryRoutes(app);
  registerAdminRoutes(app, { adminToken, presence });

  app.use(createErrorHandler(logger));

  return app;
}
