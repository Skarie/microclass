/**
 * 课程封面缩略图：用容器里的 ffmpeg 按宽度等比缩放成 webp，产物缓存到
 * `<dataDir>/cover-cache/<id>-<w>.webp`，命中直接复用。
 *
 * 为什么要有它：课程卡片只显示 276×132，原图可能是 16MB 的 3840×2160 PNG，
 * 首屏要下几十 MB。缩略图把出流压到几十 KB，且只按需生成一次。
 *
 * 约定：
 * - 生成失败**不抛给请求**：返回 `{ ok: false }`，调用方回退原图并记 warning；
 * - 同一 id+width 的并发请求共用同一个 Promise，不会同时起多个 ffmpeg；
 * - 先写临时文件、成功后再 rename，避免半成品被当成缓存命中。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const THUMB_WIDTH_MIN = 120;
export const THUMB_WIDTH_MAX = 1600;

const FFMPEG_TIMEOUT_MS = 20_000;
const WEBP_QUALITY = 80;

export type ThumbnailResult = { ok: true; file: string } | { ok: false; error: string };

export interface ThumbnailOptions {
  /** ffmpeg 可执行文件（留空则按 PATH 探测，与媒体优化一致） */
  ffmpegPath: string;
  /** 缓存目录：`<dataDir>/cover-cache` */
  cacheDir: string;
  /** 测试注入：替换真实子进程，参数与真实 ffmpeg 一致 */
  run?: (args: string[]) => Promise<void>;
}

/** 解析 `?w=`：合法返回宽度，非法（非数字 / 非整数 / 越界）返回 null */
export function parseThumbnailWidth(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const width = Number(raw);
  if (!Number.isSafeInteger(width) || width < THUMB_WIDTH_MIN || width > THUMB_WIDTH_MAX) return null;
  return width;
}

/** ETag：文件大小 + mtime（缩略图内容随源文件重新生成而变化，足够区分版本） */
export function fileEtag(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  } catch {
    return null;
  }
}

/** 失败时清理临时文件，不影响主流程 */
function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* 清理失败忽略 */
  }
}

export class CoverThumbnailService {
  private readonly inflight = new Map<string, Promise<ThumbnailResult>>();

  constructor(private readonly opts: ThumbnailOptions) {
    fs.mkdirSync(this.opts.cacheDir, { recursive: true });
  }

  /** 缓存文件路径（对外可见，便于测试/运维直接定位产物） */
  cachePath(id: number, width: number): string {
    return path.join(this.opts.cacheDir, `${id}-${width}.webp`);
  }

  /** 获取缩略图：命中缓存直接返回；同 id+width 的并发只生成一次 */
  get(id: number, source: string, width: number): Promise<ThumbnailResult> {
    const file = this.cachePath(id, width);
    if (fs.existsSync(file)) return Promise.resolve({ ok: true, file });
    const key = `${id}-${width}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.generate(source, file, width).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  /** ffmpeg 命令：等比缩放到目标宽度，只取一帧、编码 webp */
  private args(source: string, target: string, width: number): string[] {
    return [
      '-v',
      'error',
      '-y',
      '-i',
      source,
      '-vf',
      `scale=${width}:-1`,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      String(WEBP_QUALITY),
      target,
    ];
  }

  private async generate(source: string, file: string, width: number): Promise<ThumbnailResult> {
    // 不同 width/进程各自用独立临时名，避免并发写花同一个文件
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp.webp`;
    try {
      await this.runFfmpeg(this.args(source, tmp, width));
      if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
        throw new Error('ffmpeg 未生成缩略图');
      }
      fs.renameSync(tmp, file);
      return { ok: true, file };
    } catch (e) {
      removeQuietly(tmp);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    if (this.opts.run) return this.opts.run(args);
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`ffmpeg 超时（${FFMPEG_TIMEOUT_MS}ms）`));
      }, FFMPEG_TIMEOUT_MS);
      timer.unref?.();
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-400);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        const tail = stderr.trim().split('\n').pop() ?? '';
        reject(new Error(`${tail}（ffmpeg exit ${code}）`));
      });
    });
  }
}
