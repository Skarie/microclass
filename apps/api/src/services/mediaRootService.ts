/**
 * 媒体根目录服务：媒体文件夹配置存 settings.media_roots（JSON），
 * 提供安全路径解析（防目录穿越）与视频扫描。
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError, VIDEO_EXTENSIONS } from '@microclass/shared';
import type { SettingsRepository } from '../db/repositories/settingsRepository.js';
import type { User } from '@microclass/shared';

export interface MediaRoot {
  id: string;
  name: string;
  path: string;
  /** 系统内置目录（站内上传的视频存这里），不允许删除 */
  internal?: boolean;
}

export interface ScannedFolder {
  folder: string;
  count: number;
  videos: string[];
}

/** 站内上传视频的媒体根 id（与 lessons.media_root 对应） */
export const UPLOAD_ROOT_ID = 'uploads';

const VIDEO_EXT_RE = new RegExp(`(${VIDEO_EXTENSIONS.join('|').replace(/\./g, '\\.')})$`, 'i');

export class MediaRootService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly repoRoot: string,
  ) {}

  list(): MediaRoot[] {
    const raw = this.settings.get('media_roots');
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((r): r is MediaRoot => {
        const o = r as Partial<MediaRoot>;
        return typeof o?.id === 'string' && typeof o?.name === 'string' && typeof o?.path === 'string';
      });
    } catch {
      return [];
    }
  }

  private save(roots: MediaRoot[]): void {
    this.settings.set('media_roots', JSON.stringify(roots));
  }

  isAvailable(root: MediaRoot): boolean {
    try {
      const abs = path.resolve(this.repoRoot, root.path);
      return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
    } catch {
      return false;
    }
  }

  add(actor: User, input: { name: string; path: string }): MediaRoot {
    const name = (input.name ?? '').trim();
    const p = (input.path ?? '').trim();
    if (!name) throw AppError.badRequest('请填写显示名称');
    if (!p) throw AppError.badRequest('请填写文件夹路径');
    const abs = path.resolve(this.repoRoot, p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw AppError.badRequest(`路径不存在或不可访问：${p}（Docker 版需先把宿主机文件夹挂载进容器）`);
    }
    const roots = this.list();
    if (roots.some((r) => r.path === p)) throw AppError.conflict('该路径已添加');
    const root: MediaRoot = { id: `m${Date.now().toString(36)}`, name, path: p };
    roots.push(root);
    this.save(roots);
    void actor;
    return root;
  }

  remove(id: string): void {
    const roots = this.list();
    const target = roots.find((r) => r.id === id);
    if (!target) throw AppError.notFound('文件夹不存在');
    if (target.internal) throw AppError.badRequest('这是系统内置的视频目录（站内上传用），不能移除');
    this.save(roots.filter((r) => r.id !== id));
  }

  /**
   * 确保站内上传目录已登记为媒体根（幂等）。
   * 网页直接上传的视频落在 <dataDir>/uploads/videos，通过它参与既有的
   * 媒体根解析与 Range 播放流程，无需运维挂载任何宿主机目录。
   */
  ensureUploadRoot(dataDir: string): void {
    const abs = path.join(dataDir, 'uploads', 'videos');
    fs.mkdirSync(abs, { recursive: true });
    const roots = this.list();
    const existing = roots.find((r) => r.id === UPLOAD_ROOT_ID);
    if (existing) {
      if (existing.path !== abs) {
        existing.path = abs;
        this.save(roots);
      }
      return;
    }
    // 内置目录放最前面，方便在管理端一眼看到
    roots.unshift({ id: UPLOAD_ROOT_ID, name: '站内上传（课程视频）', path: abs, internal: true });
    this.save(roots);
  }

  /** 解析 rootId + 相对路径 → 绝对路径（越界抛错） */
  resolve(rootId: string, relPath: string): { root: MediaRoot; abs: string; base: string } {
    const root = this.list().find((r) => r.id === rootId);
    if (!root) throw AppError.badRequest('无效的媒体目录');
    const base = path.resolve(this.repoRoot, root.path);
    const abs = path.resolve(base, String(relPath || '').replace(/^\/+/, ''));
    if (abs !== base && !abs.startsWith(base + path.sep)) throw AppError.badRequest('路径越界');
    return { root, abs, base };
  }

  /** 扫描目录下的视频（递归，按子文件夹分组） */
  scan(rootId: string, relPath = ''): { folders: ScannedFolder[]; total: number } {
    const { abs } = this.resolve(rootId, relPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw AppError.badRequest('文件夹不存在或不可访问');
    const folders: ScannedFolder[] = [];
    const walk = (dir: string, rel: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const here: string[] = [];
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const child = path.join(dir, e.name);
        if (e.isDirectory()) walk(child, rel ? `${rel}/${e.name}` : e.name);
        else if (VIDEO_EXT_RE.test(e.name)) here.push(e.name);
      }
      if (here.length) folders.push({ folder: rel, count: here.length, videos: here.sort() });
    };
    walk(abs, '');
    return { folders, total: folders.reduce((acc, f) => acc + f.count, 0) };
  }

  static isVideo(fileName: string): boolean {
    return VIDEO_EXT_RE.test(fileName);
  }
}
