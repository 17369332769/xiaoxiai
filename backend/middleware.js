import cors from 'cors';
import express from 'express';
import { AppError } from './appError.js';
import { requestLogger } from './logger.js';

export function createCorsMiddleware(allowedOrigin) {
  return cors({
    origin(origin, callback) {
      if (!origin || origin === allowedOrigin) {
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
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later.'));
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

export function createErrorHandler(logger) {
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
