export class AppError extends Error {
  constructor(message, {
    code = 'INTERNAL_ERROR',
    statusCode = 500,
    cause,
    details = null,
    expose = statusCode < 500
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.expose = expose;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message, details) {
    return new AppError(message, { code: 'BAD_REQUEST', statusCode: 400, details });
  }

  static unauthorized(message = 'Authentication is required.') {
    return new AppError(message, { code: 'UNAUTHORIZED', statusCode: 401 });
  }

  static forbidden(message = 'Access is denied.') {
    return new AppError(message, { code: 'FORBIDDEN', statusCode: 403 });
  }

  static notFound(message = 'Resource was not found.') {
    return new AppError(message, { code: 'NOT_FOUND', statusCode: 404 });
  }

  static conflict(message, details) {
    return new AppError(message, { code: 'CONFLICT', statusCode: 409, details });
  }

  static unavailable(message = 'Service is temporarily unavailable.') {
    return new AppError(message, { code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  }
}

export function toAppError(error) {
  if (error instanceof AppError) return error;
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return new AppError(error.message, { code: 'VALIDATION_ERROR', statusCode: 400, cause: error });
  }
  return new AppError('An unexpected error occurred.', {
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    cause: error,
    expose: false
  });
}
