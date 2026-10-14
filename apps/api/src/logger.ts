/**
 * 结构化日志：Fastify 内置 pino。统一脱敏与字段规范。
 */
import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config/env.js';

export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  const pretty = config.env === 'development' && process.env.MC_LOG_PRETTY !== '0';
  return {
    level: config.logLevel,
    // 敏感字段永不出现在日志里
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        'password',
        'pass',
        'oldpass',
        'newpass',
        '*.password',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}
