import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendFileWithRange } from '../src/utils/range.js';

/** 捕获状态码/响应头/响应体的最小 reply 桩，用于直接单测流式响应逻辑。 */
interface Captured {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function makeReply(cap: Captured): FastifyReply {
  const reply = {
    status(code: number) {
      cap.status = code;
      return reply;
    },
    header(key: string, value: string) {
      cap.headers[key.toLowerCase()] = value;
      return reply;
    },
    send(body?: unknown) {
      cap.body = body;
      return reply;
    },
  };
  return reply as unknown as FastifyReply;
}

function makeReq(range?: string): FastifyRequest {
  return { headers: range === undefined ? {} : { range }, requestId: 'test-req' } as unknown as FastifyRequest;
}

function capture(): Captured {
  return { status: 200, headers: {}, body: undefined };
}

/**
 * 消费响应流：既断言真实返回的字节数，也避免遗留未消费的 ReadStream
 * 在临时目录被清理后抛出未处理的 ENOENT。
 */
async function drain(body: unknown): Promise<number> {
  if (typeof body !== 'object' || body === null || !(Symbol.asyncIterator in body)) {
    throw new Error('响应体不是可读流');
  }
  let bytes = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    bytes += chunk.length;
  }
  return bytes;
}

let dir: string;
let video: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-range-'));
  video = path.join(dir, 'sample.mp4');
  fs.writeFileSync(video, Buffer.from('0123456789')); // 10 字节
  fs.mkdirSync(path.join(dir, 'folder'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('HTTP Range 分片响应', () => {
  it('无 Range 时返回整文件并声明支持 Range', async () => {
    const cap = capture();
    sendFileWithRange(makeReq(), makeReply(cap), video);
    expect(cap.status).toBe(200);
    expect(cap.headers['content-length']).toBe('10');
    expect(cap.headers['content-type']).toBe('video/mp4');
    expect(cap.headers['accept-ranges']).toBe('bytes');
    expect(cap.headers['cache-control']).toBe('no-store');
    expect(cap.body).toBeInstanceOf(fs.ReadStream);
    await expect(drain(cap.body)).resolves.toBe(10);
  });

  it('bytes=0-3 返回 206 与对应区间', async () => {
    const cap = capture();
    sendFileWithRange(makeReq('bytes=0-3'), makeReply(cap), video);
    expect(cap.status).toBe(206);
    expect(cap.headers['content-range']).toBe('bytes 0-3/10');
    expect(cap.headers['content-length']).toBe('4');
    expect(cap.body).toBeInstanceOf(fs.ReadStream);
    await expect(drain(cap.body)).resolves.toBe(4);
  });

  it('开放区间 bytes=6- 一直取到文件末尾', async () => {
    const cap = capture();
    sendFileWithRange(makeReq('bytes=6-'), makeReply(cap), video);
    expect(cap.status).toBe(206);
    expect(cap.headers['content-range']).toBe('bytes 6-9/10');
    expect(cap.headers['content-length']).toBe('4');
    await expect(drain(cap.body)).resolves.toBe(4);
  });

  it('后缀区间 bytes=-4 取最后 4 字节（播放器拖到结尾）', async () => {
    const cap = capture();
    sendFileWithRange(makeReq('bytes=-4'), makeReply(cap), video);
    expect(cap.status).toBe(206);
    expect(cap.headers['content-range']).toBe('bytes 6-9/10');
    expect(cap.headers['content-length']).toBe('4');
    await expect(drain(cap.body)).resolves.toBe(4);
  });

  it('超出文件末尾的 end 会被裁剪到末尾', async () => {
    const cap = capture();
    sendFileWithRange(makeReq('bytes=8-999'), makeReply(cap), video);
    expect(cap.status).toBe(206);
    expect(cap.headers['content-range']).toBe('bytes 8-9/10');
    await expect(drain(cap.body)).resolves.toBe(2);
  });

  it('start 大于 end 时返回 416 并告知总长度', () => {
    const cap = capture();
    sendFileWithRange(makeReq('bytes=9-2'), makeReply(cap), video);
    expect(cap.status).toBe(416);
    expect(cap.headers['content-range']).toBe('bytes */10');
    expect(cap.body).toBeUndefined();
  });

  it('文件不存在返回 404 错误信封', () => {
    const cap = capture();
    sendFileWithRange(makeReq(), makeReply(cap), path.join(dir, 'nope.mp4'));
    expect(cap.status).toBe(404);
    expect(cap.body).toMatchObject({ error: { code: 'NOT_FOUND', requestId: 'test-req' } });
  });

  it('目标不是文件（目录）时返回 404', () => {
    const cap = capture();
    sendFileWithRange(makeReq(), makeReply(cap), path.join(dir, 'folder'));
    expect(cap.status).toBe(404);
    expect(cap.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  // Windows 上 chmod 语义不同（无 POSIX 权限位），该用例仅在 Linux/macOS 生效
  it.skipIf(process.platform === 'win32')('文件存在但无读权限时返回 403 与可操作提示（而不是含糊的 500）', () => {
    const locked = path.join(dir, 'locked.mp4');
    fs.writeFileSync(locked, Buffer.from('0123456789'));
    fs.chmodSync(locked, 0o000);
    try {
      const cap = capture();
      sendFileWithRange(makeReq('bytes=0-3'), makeReply(cap), locked);
      expect(cap.status).toBe(403);
      expect(cap.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(String((cap.body as { error: { message: string } }).error.message)).toContain('读权限');
    } finally {
      fs.chmodSync(locked, 0o600);
    }
  });
});
