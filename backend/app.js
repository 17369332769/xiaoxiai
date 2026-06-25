import express from 'express';
import { createErrorHandler, applyCommonMiddleware } from './core/middleware.js';
import { registerApiRoutes } from './routes/apiRoutes.js';
import { registerOrderRoutes } from './routes/orderRoutes.js';
import { registerAccountRoutes } from './routes/accountRoutes.js';
import { registerCommunityRoutes } from './routes/communityRoutes.js';
import { registerAnalyticsRoutes } from './routes/analyticsRoutes.js';
import { registerMemoryRoutes } from './routes/memoryRoutes.js';
import { registerTtsRoutes } from './routes/ttsRoutes.js';
import { registerUserRoutes } from './routes/userRoutes.js';
import { registerThemeRoutes } from './routes/themeRoutes.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { createPresenceTracker } from './services/presence.js';
import { createResolveUser } from './core/resolveUser.js';
import { dbGet } from './core/db.js';

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
  allowSimulatedPayment = false,
  trustProxy = 'loopback',
}) {
  const app = express();

  // Behind the documented Nginx reverse proxy, the real client IP arrives in
  // X-Forwarded-For. Express only honors it when 'trust proxy' is set; without
  // this, req.ip collapses to the proxy's loopback address for every user,
  // which would turn both the per-IP rate limiter and the login throttle into a
  // single shared bucket (whole-site / victim-lockout DoS). Default 'loopback'
  // suits the local-Nginx topology and is safe for direct dev connections; do
  // NOT use `true` (it lets clients spoof X-Forwarded-For).
  app.set('trust proxy', trustProxy);

  // Liveness/readiness probe for load balancers and uptime monitors. Registered
  // BEFORE CORS/rate-limit so health polls always succeed and never consume a
  // rate-limit bucket; no auth (probes are anonymous). Reports DB connectivity.
  app.get('/api/health', async (req, res) => {
    try {
      await dbGet('SELECT 1 AS ok');
      res.json({ ok: true, db: 'up' });
    } catch (error) {
      logger?.error?.('Health check DB probe failed', { error: error?.message });
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  applyCommonMiddleware(app, {
    allowedOrigin,
    rateLimitWindowMs,
    rateLimitMaxRequests,
  });

  const presence = createPresenceTracker({ ttlMs: 60000, baseline: presenceBaseline });
  app.locals.presence = presence;

  // Token-aware userId resolver shared by every authenticated business route.
  const resolveUser = createResolveUser(authSecret);

  registerApiRoutes(app, { openai, logger, presence, resolveUser, allowSimulatedPayment });
  registerOrderRoutes(app, { paymentSecret, presence, logger, resolveUser, allowSimulatedPayment });
  registerAccountRoutes(app, { authSecret });
  registerCommunityRoutes(app, { presence, resolveUser });
  registerAnalyticsRoutes(app, { resolveUser });
  registerMemoryRoutes(app, { resolveUser });
  registerTtsRoutes(app, { resolveUser });
  registerUserRoutes(app, { resolveUser });
  registerThemeRoutes(app, { resolveUser, presence });
  registerAdminRoutes(app, { adminToken, presence });

  app.use(createErrorHandler(logger));

  return app;
}
