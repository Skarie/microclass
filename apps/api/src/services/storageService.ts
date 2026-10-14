/**
 * 存储服务：上传文件（图片 / 知识点附件 / 课程视频）安全落盘与解析，防目录穿越。
 * 大文件走 saveStream（流式写盘），小文件走 save（Buffer）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '@microclass/shared';

export interface SavedFile {
  /** 相对 uploads 根目录的路径，入库用 */
  relPath: string;
  fileName: string;
  size: number;
}

/**
 * 题目配图只接受光栅图片：SVG 可以在同源下执行脚本，作为配图内联返回
 * 等于存储型 XSS，因此明确排除（如需矢量图请先转成 PNG）。
 */
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp)$/i;

/** 上传落盘时允许的扩展名与 MIME 的一致性校验，避免「改后缀绕过」 */
const BLOCKED_EXTENSIONS = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs', '.cjs', '.jsp', '.php']);

export class StorageService {
  private readonly uploadsRoot: string;

  constructor(dataDir: string) {
    this.uploadsRoot = path.join(dataDir, 'uploads');
    fs.mkdirSync(this.uploadsRoot, { recursive: true });
  }

  get root(): string {
    return this.uploadsRoot;
  }

  /** 保存上传文件；subdir 例如 covers / questions / knowledge */
  save(input: { subdir: string; fileName: string; data: Buffer; mimeType?: string; imagesOnly?: boolean }): SavedFile {
    if (!input.data || input.data.length === 0) throw AppError.badRequest('文件为空');
    if (input.imagesOnly && input.mimeType && !IMAGE_MIME.test(input.mimeType)) {
      throw AppError.badRequest('只能上传图片文件（PNG/JPEG/GIF/WebP/BMP）');
    }
    const ext = (path.extname(input.fileName || '') || '.bin')
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')
      .slice(0, 10);
    // 可执行/可内联脚本的扩展名一律拒绝（下载时也会强制 attachment，这里是第一道闸）
    if (BLOCKED_EXTENSIONS.has(ext) || input.mimeType === 'image/svg+xml') {
      throw AppError.badRequest('不支持该文件类型（HTML/SVG/脚本类文件请打包成 zip 后上传）');
    }
    const storeName = `${input.subdir}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const dir = path.join(this.uploadsRoot, input.subdir);
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, storeName);
    fs.writeFileSync(abs, input.data);
    return { relPath: `${input.subdir}/${storeName}`, fileName: input.fileName || storeName, size: input.data.length };
  }

  /**
   * 流式保存大文件（视频）：边收边写盘，不把整个文件读进内存。
   * - 只接受白名单扩展名（默认视频扩展名）；
   * - 存储名由服务端生成，原始文件名只作为展示用信息返回；
   * - 写入失败会清理半成品文件。
   */
  async saveStream(input: {
    subdir: string;
    fileName: string;
    source: NodeJS.ReadableStream;
    allowedExtensions: readonly string[];
    maxBytes?: number;
  }): Promise<SavedFile> {
    const original = path.basename(String(input.fileName || 'video'));
    const ext = (path.extname(original) || '').toLowerCase();
    const allowed = new Set(input.allowedExtensions.map((e) => e.toLowerCase()));
    if (!allowed.has(ext)) {
      throw AppError.badRequest(
        `不支持的文件类型：${ext || '（无扩展名）'}，仅支持 ${input.allowedExtensions.join(' / ')}`,
      );
    }

    const dir = path.join(this.uploadsRoot, input.subdir);
    fs.mkdirSync(dir, { recursive: true });
    const storeName = `${input.subdir}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const abs = path.join(dir, storeName);
    const relPath = `${input.subdir}/${storeName}`;

    let size = 0;
    try {
      await pipeline(
        input.source,
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            size += chunk.length;
            if (input.maxBytes !== undefined && size > input.maxBytes) {
              cb(AppError.badRequest(`文件超过大小上限（${Math.round(input.maxBytes / 1024 / 1024)} MB）`));
              return;
            }
            cb(null, chunk);
          },
        }),
        fsSync.createWriteStream(abs),
      );
    } catch (e) {
      try {
        fs.rmSync(abs, { force: true });
      } catch {
        /* 清理失败忽略 */
      }
      throw e;
    }
    if (size === 0) {
      fs.rmSync(abs, { force: true });
      throw AppError.badRequest('文件为空');
    }
    return { relPath, fileName: original, size };
  }

  /** 将入库相对路径解析为绝对路径，越界返回 null */
  resolve(relPath: string): string | null {
    const base = this.uploadsRoot;
    const full = path.resolve(base, String(relPath || '').replace(/^\/+/, ''));
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return full;
  }

  remove(relPath: string): void {
    const full = this.resolve(relPath);
    if (!full) return;
    try {
      fs.unlinkSync(full);
    } catch {
      /* 文件已不存在时忽略 */
    }
  }

  exists(relPath: string): boolean {
    const full = this.resolve(relPath);
    return !!full && fs.existsSync(full);
  }
}
