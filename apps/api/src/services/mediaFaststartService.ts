/**
 * 视频 faststart 自动优化
 *
 * 背景：mp4 的 `moov`（索引）在文件尾部时，浏览器必须把整片下完才能开始播放 ——
 * 150MB 的课时就是"点进去干等"。重封装（`-c copy -movflags +faststart`）只挪索引、
 * 不重新编码，单片几秒。
 *
 * 为什么做成后台服务而不是脚本：老师上传/挂载视频后不该再找运维手工处理。
 * 这里负责：
 *   1) 定时巡检所有媒体根（默认 15 分钟一次），发现非 faststart 的视频就排队处理；
 *   2) 上传、扫描导入进来的新文件同样会被下一轮巡检捞到；
 *   3) 暴露状态给管理端（队列长度 / 已完成 / 失败），可手动触发。
 *
 * 安全约定：
 *   - 单并发，避免和视频播放抢磁盘；
 *   - 先写临时文件，ffmpeg 成功后才原子替换原文件，失败保留原片；
 *   - 重封装不改内容，只重写索引（时长/清晰度不变）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface FaststartStatus {
  enabled: boolean;
  /** 只读媒体目录：无法原地重封装，需要改挂载权限（报告给管理员，不算失败） */
  readOnlyRoots: string[];
  queued: number;
  running: boolean;
  done: number;
  failed: number;
  lastError: string;
  lastFinishedAt: number | null;
}

const MOOV = Buffer.from('moov');

export class MediaFaststartService {
  private queue: string[] = [];
  /** 处理过的路径（成功/失败都记，避免同一轮反复排队） */
  private seen = new Set<string>();
  private running = false;
  private done = 0;
  private failed = 0;
  private lastError = '';
  private lastFinishedAt: number | null = null;
  private readonly readOnlyRoots = new Set<string>();

  constructor(private readonly opts: { ffmpegPath: string; enabled: boolean }) {}

  status(): FaststartStatus {
    return {
      enabled: this.opts.enabled,
      readOnlyRoots: [...this.readOnlyRoots],
      queued: this.queue.length,
      running: this.running,
      done: this.done,
      failed: this.failed,
      lastError: this.lastError,
      lastFinishedAt: this.lastFinishedAt,
    };
  }

  /** 视频开头 1MB 里是否有 moov：有 → 已 faststart，无需处理 */
  static isFaststart(abs: string): boolean {
    let fd: number | null = null;
    try {
      fd = fs.openSync(abs, 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.includes(MOOV);
    } catch {
      return true; // 读不到就别当任务，交给播放时报错
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  /** 扫描一个目录，把需要优化的视频入队（同步遍历，限制数量避免一次扫太久） */
  sweep(root: string, limit = 400): number {
    if (!this.opts.enabled || !this.opts.ffmpegPath) return 0;
    // 只读挂载（如 compose 里 :ro）无法原地重封装，记下来报给管理员，不要刷成失败
    try {
      fs.accessSync(root, fs.constants.W_OK);
      this.readOnlyRoots.delete(root);
    } catch {
      this.readOnlyRoots.add(root);
      return 0;
    }
    let added = 0;
    const walk = (dir: string): void => {
      if (added >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // 权限/断链目录直接跳过
      }
      for (const e of entries) {
        if (added >= limit) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(mp4|m4v)$/i.test(e.name)) {
          if (this.enqueue(p)) added += 1;
        }
      }
    };
    walk(root);
    return added;
  }

  /** 入队一个视频；返回是否真的入队 */
  enqueue(abs: string): boolean {
    if (!this.opts.enabled || !this.opts.ffmpegPath) return false;
    if (!abs || this.seen.has(abs) || this.queue.includes(abs)) return false;
    if (!fs.existsSync(abs)) return false;
    if (MediaFaststartService.isFaststart(abs)) {
      this.seen.add(abs);
      return false;
    }
    this.queue.push(abs);
    this.pump();
    return true;
  }

  private pump(): void {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    const tmp = `${next}.faststart.tmp.mp4`;
    const child = spawn(
      this.opts.ffmpegPath,
      ['-v', 'error', '-y', '-i', next, '-c', 'copy', '-movflags', '+faststart', tmp],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-400);
    });
    child.on('error', (e) => {
      this.fail(next, tmp, e.message);
    });
    child.on('close', (code) => {
      if (code === 0) {
        try {
          fs.renameSync(tmp, next); // 成功才替换
          this.done += 1;
          this.seen.add(next);
          this.lastFinishedAt = Date.now();
        } catch (e) {
          this.fail(next, tmp, String(e).slice(0, 200));
        }
      } else {
        this.fail(next, tmp, stderr.trim().split('\n').pop() || `ffmpeg exit ${code}`);
      }
      this.running = false;
      this.pump();
    });
  }

  private fail(abs: string, tmp: string, msg: string): void {
    this.failed += 1;
    this.seen.add(abs);
    this.lastError = `${path.basename(abs)}: ${msg}`;
    this.lastFinishedAt = Date.now();
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* 忽略清理失败 */
    }
  }
}
