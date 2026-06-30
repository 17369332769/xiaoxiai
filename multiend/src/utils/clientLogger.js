function shouldLog(level) {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  return level === 'warn' || level === 'error';
}

function getConsoleMethod(level) {
  if (level === 'error') {
    return console.error;
  }

  if (level === 'warn') {
    return console.warn;
  }

  return console.log;
}

function emit(level, scope, message, meta) {
  if (!shouldLog(level)) {
    return;
  }

  const method = getConsoleMethod(level);
  const prefix = `[xiaoxiai:${scope}]`;

  if (meta === undefined) {
    method(prefix, message);
    return;
  }

  method(prefix, message, meta);
}

export function createClientLogger(scope) {
  return {
    debug(message, meta) {
      emit('debug', scope, message, meta);
    },
    info(message, meta) {
      emit('info', scope, message, meta);
    },
    warn(message, meta) {
      emit('warn', scope, message, meta);
    },
    error(message, meta) {
      emit('error', scope, message, meta);
    },
  };
}
