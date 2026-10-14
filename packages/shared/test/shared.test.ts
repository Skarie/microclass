import { describe, expect, it } from 'vitest';
import {
  AUTO_GRADED_TYPES,
  AppError,
  DEFAULT_PAGE_SIZE,
  KNOWLEDGE_KINDS,
  LEVELS,
  MAX_PAGE_SIZE,
  PUBLISH_STATUS,
  QUESTION_TYPES,
  QUIZ_UNLOCK_RATIO,
  ROLES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  VIDEO_EXTENSIONS,
  VIDEO_KINDS,
  isAppError,
} from '../src/index.js';

describe('领域错误 AppError', () => {
  it('每个工厂方法都带正确的错误码与 HTTP 状态', () => {
    const cases: [AppError, string, number][] = [
      [AppError.badRequest('x'), 'BAD_REQUEST', 400],
      [AppError.unauthorized(), 'UNAUTHORIZED', 401],
      [AppError.forbidden(), 'FORBIDDEN', 403],
      [AppError.notFound(), 'NOT_FOUND', 404],
      [AppError.conflict('重复'), 'CONFLICT', 409],
      [AppError.rateLimited(), 'RATE_LIMITED', 429],
      [AppError.internal(), 'INTERNAL', 500],
    ];
    for (const [err, code, status] of cases) {
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      expect(err.name).toBe('AppError');
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('保留自定义消息与 details', () => {
    const err = AppError.badRequest('参数不合法', { field: 'username' });
    expect(err.message).toBe('参数不合法');
    expect(err.details).toEqual({ field: 'username' });
  });

  it('默认消息面向终端用户且为中文', () => {
    expect(AppError.unauthorized().message).toBe('请先登录');
    expect(AppError.forbidden().message).toBe('没有权限执行该操作');
    expect(AppError.notFound().message).toBe('资源不存在');
    expect(AppError.rateLimited().message).toContain('频繁');
  });

  it('isAppError 用于区分领域错误与未知异常', () => {
    expect(isAppError(AppError.notFound())).toBe(true);
    expect(isAppError(new Error('boom'))).toBe(false);
    expect(isAppError('boom')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe('共享常量契约', () => {
  it('角色与题型枚举保持稳定取值（前后端与数据库共用）', () => {
    expect(ROLES).toEqual(['admin', 'teacher', 'student']);
    expect(QUESTION_TYPES).toEqual(['single', 'multiple', 'judge', 'fill', 'short']);
    expect(VIDEO_KINDS).toEqual(['local', 'embed', 'url']);
    expect(KNOWLEDGE_KINDS).toEqual(['text', 'file', 'link']);
    expect(PUBLISH_STATUS).toEqual(['draft', 'published']);
  });

  it('只有客观题参与自动判分', () => {
    expect(AUTO_GRADED_TYPES).toEqual(['single', 'multiple', 'judge', 'fill']);
    expect(AUTO_GRADED_TYPES).not.toContain('short');
  });

  it('视频扩展名统一带点且小写', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      expect(ext.startsWith('.')).toBe(true);
      expect(ext).toBe(ext.toLowerCase());
    }
    expect(VIDEO_EXTENSIONS).toContain('.mp4');
  });

  it('学习等级阈值单调递增且从 0 分钟起步', () => {
    expect(LEVELS[0]?.minMinutes).toBe(0);
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i]!.minMinutes).toBeGreaterThan(LEVELS[i - 1]!.minMinutes);
    }
  });

  it('会话与分页参数符合约定', () => {
    expect(SESSION_COOKIE).toBe('microclass_sid');
    expect(SESSION_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it('刷题解锁比例在 (0,1] 区间内', () => {
    expect(QUIZ_UNLOCK_RATIO).toBeGreaterThan(0);
    expect(QUIZ_UNLOCK_RATIO).toBeLessThanOrEqual(1);
  });
});
