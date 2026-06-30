import cors from 'cors';
import express from 'express';
import { AppError } from './appError.js';
import { requestLogger } from './logger.js';

export function createCorsMiddleware(allowedOrigin) {
  // ALLOWED_ORIGIN may be a single origin or a comma-separated list, so the same
  // backend can serve the local dev origin plus LAN origins (e.g. http://192.168.x.x:5173).
  const allowList = String(allowedOrigin || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      if (!origin || allowList.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, 'FORBIDDEN_ORIGIN', 'Origin not allowed'));
    },
  });
}

export function createRateLimitMiddleware(windowMs, maxRequests) {
  const rateLimitBuckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = rateLimitBuckets.get(ip);

    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= maxRequests) {
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later.', {
        retryAfterMs: Math.max(0, bucket.resetAt - now),
      }));
      return;
    }

    bucket.count += 1;
    next();
  };
}

export function applyCommonMiddleware(app, { allowedOrigin, rateLimitWindowMs, rateLimitMaxRequests }) {
  app.use(createCorsMiddleware(allowedOrigin));
  app.use(requestLogger());
  app.use(express.json({ limit: '100kb' }));
  app.use(createRateLimitMiddleware(rateLimitWindowMs, rateLimitMaxRequests));
}

// `onServerError` is an optional best-effort sink for 5xx failures (e.g. persist
// to an error_logs table). It is injected by the composition root so this core
// module never imports a service. It must not throw; we still fire-and-forget it.
export function createErrorHandler(logger, onServerError = null) {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
      });
      return;
    }

    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof AppError ? error.message : 'Server error';
    const details = error instanceof AppError ? error.details : null;

    if (error instanceof AppError) {
      if (status >= 500) {
        logger.error(`Application error: ${code}`, { message, error });
      }
    } else if (status >= 500) {
      logger.error('Unhandled server error', { error });
    }

    // Persist 5xx failures for the operator dashboard. Best-effort and detached:
    // a logging sink that rejects must never break the error response itself.
    if (status >= 500 && typeof onServerError === 'function') {
      Promise.resolve(
        onServerError({
          code,
          status,
          message,
          path: req.originalUrl || req.url || '',
          method: req.method || '',
          stack: error?.stack || '',
        })
      ).catch(() => { /* never let logging mask the response */ });
    }

    // Standard Retry-After (seconds) for throttle responses so clients (and well-
    // behaved proxies) know how long to back off; the same hint also rides in
    // details.retryAfterMs for the SPA.
    if (status === 429 && details && Number.isFinite(details.retryAfterMs)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(details.retryAfterMs / 1000))));
    }

    res.status(status).json({
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    });
  };
}
