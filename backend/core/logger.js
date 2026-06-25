import dotenv from 'dotenv';

dotenv.config();

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeLevel(level) {
  const normalized = String(level || '').toLowerCase();
  return LOG_LEVELS[normalized] ? normalized : 'info';
}

function normalizeBoolean(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }

  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function serializeValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeValue(nestedValue)])
    );
  }

  return value;
}

const configuredLevel = normalizeLevel(process.env.LOG_LEVEL);
const minLevelValue = LOG_LEVELS[configuredLevel];
const requestLoggingEnabled = normalizeBoolean(process.env.LOG_REQUESTS, true);

function writeLog(level, scope, message, meta) {
  if (LOG_LEVELS[level] < minLevelValue) {
    return;
  }

  const timestamp = new Date().toISOString();
  const scopePart = scope ? ` [${scope}]` : '';
  let line = `[${timestamp}] [${level.toUpperCase()}]${scopePart} ${message}`;

  if (meta !== undefined) {
    try {
      line += ` ${JSON.stringify(serializeValue(meta))}`;
    } catch {
      line += ' {"meta":"[unserializable]"}';
    }
  }

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createLogger(scope) {
  return {
    debug(message, meta) {
      writeLog('debug', scope, message, meta);
    },
    info(message, meta) {
      writeLog('info', scope, message, meta);
    },
    warn(message, meta) {
      writeLog('warn', scope, message, meta);
    },
    error(message, meta) {
      writeLog('error', scope, message, meta);
    },
  };
}

export function requestLogger() {
  return (req, res, next) => {
    if (!requestLoggingEnabled) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level =
        res.statusCode >= 500 ? 'error' :
        res.statusCode >= 400 ? 'warn' :
        'info';

      writeLog(level, 'http', `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`, {
        ip: req.ip || req.socket?.remoteAddress || 'unknown',
      });
    });

    next();
  };
}

export const logger = createLogger();
export const logConfig = {
  level: configuredLevel,
  requestLoggingEnabled,
};
