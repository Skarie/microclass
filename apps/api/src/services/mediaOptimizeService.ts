/**
 * 视频入库优化（自动）：faststart + HLS
 *
 * 为什么要有它：mp4 的 `moov` 在文件尾部时浏览器要下完整片才能播；单码率 MP4 也没有
 * 弱网降档与分段拖动的能力。主流做法是 HLS —— 分段 + m3u8，起播只需要第一个分片。
 *
 * 关键设计：
 *   1) **全自动**：定时巡检所有媒体根 + 上传后立即入队，新视频不需要人工处理；
 *   2) **不碰源文件**：HLS 产物写到数据目录 `media-cache/hls/<key>/`，只读媒体挂载也能用；
 *   3) **不重编码**：`-c copy` 直接切分片（源为 H.264/AAC 时），单片几秒；
 *   4) **幂等**：按「源路径 + 大小 + 修改时间」算 key，产物存在就跳过；
 *   5) 单并发、失败留原因，状态可查询。
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface MediaOptimizeStatus {
  enabled: boolean;
  /** 只读媒体目录（无法原地 faststart，但仍可生成 HLS 到缓存目录） */
  readOnlyRoots: string[];
  queued: number;
  running: boolean;
  current: string;
  done: number;
  failed: number;
  hlsDone: number;
  hlsFailed: number;
  lastError: string;
  lastFinishedAt: number | null;
}

const MOOV = Buffer.from('moov');

export class MediaOptimizeService {
  private queue: string[] = [];
  private seen = new Set<string>();
  private running = false;
  private done = 0;
  private failed = 0;
  private hlsDone = 0;
  private hlsFailed = 0;
  private lastError = '';
  private current = '';
  private lastFinishedAt: number | null = null;
  private readonly readOnlyRoots = new Set<string>();

  constructor(private readonly opts: { ffmpegPath: string; enabled: boolean; cacheDir: string }) {
    fs.mkdirSync(path.join(this.opts.cacheDir, 'hls'), { recursive: true });
  }

  status(): MediaOptimizeStatus {
    return {
      enabled: this.opts.enabled,
      readOnlyRoots: [...this.readOnlyRoots],
      queued: this.queue.length,
      running: this.running,
      current: this.current,
      done: this.done,
      failed: this.failed,
      hlsDone: this.hlsDone,
      hlsFailed: this.hlsFailed,
      lastError: this.lastError,
      lastFinishedAt: this.lastFinishedAt,
    };
  }

  /** 视频开头 1MB 里是否有 moov：有 → 已 faststart */
  static isFaststart(abs: string): boolean {
    let fd: number | null = null;
    try {
      fd = fs.openSync(abs, 'r');
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.includes(MOOV);
    } catch {
      return true;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  /** HLS 产物目录：源路径 + 大小 + mtime 决定，源文件变了自然换新目录 */
  hlsDirOf(abs: string): string | null {
    try {
      const st = fs.statSync(abs);
      const key = crypto
        .createHash('sha1')
        .update(`${abs}:${st.size}:${Math.floor(st.mtimeMs)}`)
        .digest('hex')
        .slice(0, 20);
      return path.join(this.opts.cacheDir, 'hls', key);
    } catch {
      return null;
    }
  }

  /** HLS 是否已就绪（主播放列表存在），返回产物目录 */
  hlsReady(abs: string): string | null {
    const dir = this.hlsDirOf(abs);
    if (!dir) return null;
    return fs.existsSync(path.join(dir, 'index.m3u8')) ? dir : null;
  }

  /** 扫描目录：没有 HLS 产物的视频入队 */
  sweep(root: string, limit = 200): number {
    if (!this.opts.enabled || !this.opts.ffmpegPath) return 0;
    try {
      fs.accessSync(root, fs.constants.R_OK);
    } catch {
      return 0;
    }
    let added = 0;
    const walk = (dir: string): void => {
      if (added >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (added >= limit) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(mp4|m4v|mov)$/i.test(e.name) && this.enqueue(p)) added += 1;
      }
    };
    walk(root);
    return added;
  }

  /** 入队：HLS 产物不存在就需要处理 */
  enqueue(abs: string): boolean {
    if (!this.opts.enabled || !this.opts.ffmpegPath) return false;
    if (!abs || this.seen.has(abs) || this.queue.includes(abs)) return false;
    if (!fs.existsSync(abs)) return false;
    if (this.hlsReady(abs)) {
      this.seen.add(abs);
      return false;
    }
    this.queue.push(abs);
    this.pump();
    return true;
  }

  private pump(): void {
    if (this.running) return;
    const src = this.queue.shift();
    if (!src) return;
    this.running = true;
    this.current = path.basename(src);
    this.ensureFaststart(src, () => this.buildHls(src));
  }

  /** 第一步：能写就顺手把 moov 前置（MP4 兜底播放也快）；只读挂载跳过 */
  private ensureFaststart(src: string, next: () => void): void {
    let writable = true;
    try {
      fs.accessSync(path.dirname(src), fs.constants.W_OK);
    } catch {
      writable = false;
      this.readOnlyRoots.add(path.dirname(src));
    }
    if (!writable || MediaOptimizeService.isFaststart(src)) {
      next();
      return;
    }
    const tmp = `${src}.faststart.tmp.mp4`;
    this.runFfmpeg(['-v', 'error', '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', tmp], (ok, err) => {
      if (ok) {
        try {
          fs.renameSync(tmp, src);
          this.done += 1;
        } catch (e) {
          this.fail(String(e).slice(0, 200));
        }
      } else {
        this.fail(err);
        try {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      next();
    });
  }

  /** 第二步：切 HLS（-c copy，不重编码） */
  private buildHls(src: string): void {
    const dir = this.hlsDirOf(src);
    if (!dir) {
      this.finish();
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const args = [
      '-v',
      'error',
      '-y',
      '-i',
      src,
      '-c',
      'copy',
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_playlist_type',
      'vod',
      '-hls_flags',
      'independent_segments',
      '-hls_segment_filename',
      path.join(dir, 'seg%05d.ts'),
      path.join(dir, 'index.m3u8'),
    ];
    this.runFfmpeg(args, (ok, err) => {
      if (ok) {
        this.hlsDone += 1;
        this.seen.add(src);
      } else {
        this.hlsFailed += 1;
        this.fail(err);
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        this.seen.add(src); // 源文件本身有问题，别每轮反复重试
      }
      this.finish();
    });
  }

  private finish(): void {
    this.running = false;
    this.current = '';
    this.lastFinishedAt = Date.now();
    this.pump();
  }

  private fail(msg: string): void {
    this.failed += 1;
    this.lastError = `${this.current}: ${msg}`.slice(0, 300);
  }

  private runFfmpeg(args: string[], done: (ok: boolean, err: string) => void): void {
    const child = spawn(this.opts.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-400);
    });
    child.on('error', (e) => done(false, e.message));
    child.on('close', (code) => done(code === 0, stderr.trim().split('\n').pop() || `ffmpeg exit ${code}`));
  }
}
