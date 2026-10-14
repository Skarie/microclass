/**
 * 统一错误处理与请求上下文：所有错误响应遵循 {error:{code,message,requestId}}。
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isAppError } from '@microclass/shared';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest('requestId', '');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : crypto.randomUUID();
  });

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    reply.header('x-request-id', req.requestId);
    return payload;
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  // 唯一 404 处理器：/api/* 返回 JSON 错误信封；其余路径在前端产物存在时回退 index.html（SPA）
  app.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith('/api/') && app.hasReplyDecorator('sendFile')) {
      void reply.type('text/html; charset=utf-8').sendFile('index.html');
      return;
    }
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `接口不存在: ${req.method} ${req.url}`, requestId: req.requestId },
    });
  });

  app.setErrorHandler((error, req, reply) => {
    // 校验错误（Fastify schema）
    if ((error as { validation?: unknown }).validation) {
      const details = (error as { validation?: unknown }).validation;
      void reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: '请求参数校验失败', requestId: req.requestId, details },
      });
      return;
    }
    if (isAppError(error)) {
      void reply.status(error.status).send({
        error: { code: error.code, message: error.message, requestId: req.requestId, details: error.details },
      });
      return;
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      void reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试', requestId: req.requestId },
      });
      return;
    }
    req.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误', requestId: req.requestId },
    });
  });
}

export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  return AppError.internal(e instanceof Error ? e.message : String(e));
}
