/**
 * 403 分支的回归防护：不依赖 POSIX 权限位（Windows 也能跑）。
 * 通过打桩 fs.accessSync 让其抛 EACCES，验证「返回 403 错误信封且不抛异常」。
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendFileWithRange } from '../src/utils/range.js';

describe('文件不可读 → 403（不依赖文件系统权限）', () => {
  it('accessSync 抛错时返回 403 错误信封，且日志走 req.log', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-range403-'));
    const file = path.join(dir, 'x.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789'));

    const logged: string[] = [];
    const req = {
      headers: { range: 'bytes=0-3' },
      requestId: 'test-req',
      log: { error: () => logged.push('error'), warn: () => {}, info: () => {}, debug: () => {} },
    } as unknown as FastifyRequest;
    const cap: { status: number; body: unknown } = { status: 200, body: undefined };
    const reply = {
      status(code: number) {
        cap.status = code;
        return this;
      },
      send(body: unknown) {
        cap.body = body;
        return this;
      },
    } as unknown as FastifyReply;

    const spy = vi.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    try {
      expect(() => sendFileWithRange(req, reply, file)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(cap.status).toBe(403);
    expect(cap.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(String((cap.body as { error: { message: string } }).error.message)).toContain('读权限');
    expect(logged).toEqual(['error']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
