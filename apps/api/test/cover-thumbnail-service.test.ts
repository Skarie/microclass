import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverThumbnailService, fileEtag, parseThumbnailWidth } from '../src/services/coverThumbnailService.js';

const dirs: string[] = [];

function tmpCacheDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cover-cache-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 假 ffmpeg：把 webp 字节写到最后一个参数（输出路径） */
function fakeRunner(bytes: Buffer, calls: string[][]): { run: (args: string[]) => Promise<void> } {
  return {
    run: (args) => {
      calls.push(args);
      fs.writeFileSync(args[args.length - 1] ?? '', bytes);
      return Promise.resolve();
    },
  };
}

describe('封面缩略图服务', () => {
  it('未命中时生成到 <cacheDir>/<id>-<w>.webp，并复用缓存', async () => {
    const cacheDir = tmpCacheDir();
    const calls: string[][] = [];
    const service = new CoverThumbnailService({
      ffmpegPath: '/no/such/ffmpeg',
      cacheDir,
      ...fakeRunner(Buffer.from('fake-webp'), calls),
    });

    const first = await service.get(7, '/tmp/cover.png', 276);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.file).toBe(path.join(cacheDir, '7-276.webp'));
    expect(fs.readFileSync(first.file)).toEqual(Buffer.from('fake-webp'));
    expect(calls).toHaveLength(1);

    const second = await service.get(7, '/tmp/cover.png', 276);
    expect(second).toEqual({ ok: true, file: first.file });
    expect(calls).toHaveLength(1);
  });

  it('ffmpeg 参数按宽度等比缩放并输出 webp', async () => {
    const cacheDir = tmpCacheDir();
    const calls: string[][] = [];
    const service = new CoverThumbnailService({
      ffmpegPath: 'ffmpeg',
      cacheDir,
      ...fakeRunner(Buffer.from('x'), calls),
    });
    await service.get(3, '/tmp/a.png', 320);
    const args = calls[0] ?? [];
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('/tmp/a.png');
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=320:-1');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libwebp');
    expect(args[args.length - 1]).toMatch(/3-320\.webp\..*\.tmp\.webp$/);
  });

  it('同一 id+width 的并发请求只生成一次', async () => {
    const cacheDir = tmpCacheDir();
    const calls: string[][] = [];
    const service = new CoverThumbnailService({
      ffmpegPath: 'ffmpeg',
      cacheDir,
      ...fakeRunner(Buffer.from('x'), calls),
    });
    const results = await Promise.all([
      service.get(5, '/tmp/a.png', 400),
      service.get(5, '/tmp/a.png', 400),
      service.get(5, '/tmp/a.png', 400),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('不同宽度分别生成缓存文件', async () => {
    const cacheDir = tmpCacheDir();
    const calls: string[][] = [];
    const service = new CoverThumbnailService({
      ffmpegPath: 'ffmpeg',
      cacheDir,
      ...fakeRunner(Buffer.from('x'), calls),
    });
    await service.get(5, '/tmp/a.png', 120);
    await service.get(5, '/tmp/a.png', 1200);
    expect(calls).toHaveLength(2);
    expect(fs.existsSync(path.join(cacheDir, '5-120.webp'))).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, '5-1200.webp'))).toBe(true);
  });

  it('ffmpeg 失败时返回 ok:false，不留下半成品', async () => {
    const cacheDir = tmpCacheDir();
    const service = new CoverThumbnailService({
      ffmpegPath: 'ffmpeg',
      cacheDir,
      run: () => Promise.reject(new Error('boom')),
    });
    const result = await service.get(9, '/tmp/a.png', 276);
    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(fs.readdirSync(cacheDir)).toHaveLength(0);
  });

  it('ffmpeg 退出码 0 但没有产物也按失败处理', async () => {
    const cacheDir = tmpCacheDir();
    const service = new CoverThumbnailService({
      ffmpegPath: 'ffmpeg',
      cacheDir,
      run: () => Promise.resolve(),
    });
    const result = await service.get(9, '/tmp/a.png', 276);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('未生成缩略图');
  });
});

describe('parseThumbnailWidth', () => {
  it('接受 120~1600 的整数字符串', () => {
    expect(parseThumbnailWidth('120')).toBe(120);
    expect(parseThumbnailWidth('276')).toBe(276);
    expect(parseThumbnailWidth('1600')).toBe(1600);
  });

  it('拒绝非数字、小数、越界与非字符串', () => {
    for (const raw of ['', 'abc', '12.5', '119', '1601', '-1', ' 276', '2e3', undefined, null, 276]) {
      expect(parseThumbnailWidth(raw)).toBeNull();
    }
  });
});

describe('fileEtag', () => {
  it('基于文件大小+mtime，文件不存在返回 null', () => {
    const dir = tmpCacheDir();
    const file = path.join(dir, 'a.webp');
    fs.writeFileSync(file, 'hello');
    const etag = fileEtag(file);
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(fileEtag(file)).toBe(etag);
    fs.writeFileSync(file, 'hello world');
    expect(fileEtag(file)).not.toBe(etag);
    expect(fileEtag(path.join(dir, 'missing.webp'))).toBeNull();
  });
});
