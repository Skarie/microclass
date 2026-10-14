/**
 * 视频元数据抽取：ffprobe 取时长、ffmpeg 抽封面帧。
 *
 * 参考飞牛「轻课堂」的做法（其 helpers/media.js 同样用 ffprobe/ffmpeg，
 * 课时表里存 duration/cover_path）。这里的设计要点：
 * - **可选能力**：容器/宿主没装 ffmpeg 时不报错，只跳过（`available=false`），
 *   其余功能（播放、进度、判分）完全不受影响；
 * - 路径通过 `MC_FFMPEG_PATH` / `MC_FFPROBE_PATH` 覆盖，否则在 PATH 上探测；
 * - 抽帧只取一帧（默认第 10% 处或第 3 秒），生成 JPEG 封面到 uploads/covers。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ProbeResult {
  durationSec: number | null;
  mediaType: 'video' | 'audio' | 'other';
  coverRelPath: string | null;
}

export interface ProbeOptions {
  /** ffprobe 可执行文件（为空则按 PATH 探测） */
  ffprobePath?: string;
  /** ffmpeg 可执行文件（为空则按 PATH 探测） */
  ffmpegPath?: string;
  /** 抽帧时间点（秒）；默认按视频时长的 10% 取，最长不超过 30 秒 */
  coverAtSec?: number;
  /** 封面落盘目录（绝对路径） */
  coversDir: string;
  /** 单次探测超时（毫秒），超时即放弃 */
  timeoutMs?: number;
}

export class MediaProbeService {
  private readonly ffprobe: string;
  private readonly ffmpeg: string;
  private readonly timeoutMs: number;
  private cachedAvailable: boolean | null = null;

  constructor(private readonly options: ProbeOptions) {
    this.ffprobe = options.ffprobePath?.trim() || 'ffprobe';
    this.ffmpeg = options.ffmpegPath?.trim() || 'ffmpeg';
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** ffprobe 是否可用（结果缓存，避免每次 spawn） */
  async available(): Promise<boolean> {
    if (this.cachedAvailable !== null) return this.cachedAvailable;
    try {
      await run(this.ffprobe, ['-version'], { timeout: 5_000 });
      this.cachedAvailable = true;
    } catch {
      this.cachedAvailable = false;
    }
    return this.cachedAvailable;
  }

  /** 抽取时长与类型；失败返回 null（调用方决定是否重试） */
  async probe(absPath: string): Promise<ProbeResult | null> {
    if (!fs.existsSync(absPath)) return null;
    if (!(await this.available())) return null;

    let durationSec: number | null = null;
    let mediaType: ProbeResult['mediaType'] = 'other';
    try {
      const { stdout } = await run(
        this.ffprobe,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absPath],
        { timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout) as {
        format?: { duration?: string };
        streams?: { codec_type?: string }[];
      };
      const duration = Number.parseFloat(parsed.format?.duration ?? '');
      if (Number.isFinite(duration) && duration > 0) durationSec = Math.round(duration);
      const types = new Set((parsed.streams ?? []).map((s) => s.codec_type));
      if (types.has('video')) mediaType = 'video';
      else if (types.has('audio')) mediaType = 'audio';
    } catch {
      return null;
    }

    const coverRelPath = await this.extractCover(absPath, durationSec);
    return { durationSec, mediaType, coverRelPath };
  }

  /** 抽一帧做封面；失败返回 null（不影响时长入库） */
  private async extractCover(absPath: string, durationSec: number | null): Promise<string | null> {
    const at = this.options.coverAtSec ?? Math.min(30, Math.max(1, Math.floor((durationSec ?? 10) * 0.1)));
    fs.mkdirSync(this.options.coversDir, { recursive: true });
    const name = `lesson_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
    const abs = path.join(this.options.coversDir, name);
    try {
      await run(
        this.ffmpeg,
        ['-v', 'error', '-ss', String(at), '-i', absPath, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', abs],
        { timeout: this.timeoutMs },
      );
      if (fs.existsSync(abs) && fs.statSync(abs).size > 0) return path.posix.join('covers', name);
    } catch {
      /* 抽帧失败忽略 */
    }
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      /* 忽略 */
    }
    return null;
  }
}
