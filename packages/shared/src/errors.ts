/**
 * 领域错误：服务层抛出，HTTP 层统一映射为错误信封。
 */

export type ErrorCode =
  'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, details);
  }
  static unauthorized(message = '请先登录'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }
  static forbidden(message = '没有权限执行该操作'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = '资源不存在'): AppError {
    return new AppError('NOT_FOUND', message);
  }
  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }
  static rateLimited(message = '操作过于频繁，请稍后再试'): AppError {
    return new AppError('RATE_LIMITED', message);
  }
  static internal(message = '服务器内部错误', details?: unknown): AppError {
    return new AppError('INTERNAL', message, details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
