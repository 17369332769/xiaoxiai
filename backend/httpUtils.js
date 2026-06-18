import { AppError } from './appError.js';

export function sanitizeUserId(userId) {
  if (typeof userId !== 'string') {
    throw new AppError(400, 'INVALID_USER_ID', 'userId is required');
  }

  const trimmed = userId.trim();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(trimmed)) {
    throw new AppError(400, 'INVALID_USER_ID', 'userId format is invalid');
  }

  return trimmed;
}

export function sanitizeText(text) {
  if (typeof text !== 'string') {
    throw new AppError(400, 'INVALID_TEXT', 'text is required');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new AppError(400, 'INVALID_TEXT', 'text cannot be empty');
  }

  if (trimmed.length > 500) {
    throw new AppError(400, 'TEXT_TOO_LONG', 'text must be 500 characters or fewer');
  }

  return trimmed;
}

export function validateChoice(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new AppError(400, 'INVALID_PARAMETER', `${fieldName} is invalid`);
  }

  return value;
}

export function sendJson(res, payload) {
  res.json({
    ok: true,
    ...payload,
  });
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
