/**
 * 知识点图片仓库：存 `<dataDir>/knowledge-media/`，文件名 `<sha1 前缀>-<原名>`。
 *
 * 与题图仓库（uploads/question-media，纯内容寻址）不同，这里保留原名，方便老师
 * 在 Markdown 里看出图片对应哪张素材；sha1 前缀负责去重与缓存失效。
 * 只读路由 `GET /api/v1/knowledge-media/:file` 按文件名白名单校验，防目录穿越。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 允许的扩展名（不含 SVG：同源内联 SVG 可执行脚本） */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/** 文件名白名单：字母（含中文）、数字、点、下划线、连字符；不允许路径分隔符 */
const FILE_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,180}$/u;

export interface SavedKnowledgeImage {
  /** 落盘文件名（拼 URL 用） */
  file: string;
  /** 可直接放进 Markdown 的 URL */
  url: string;
  /** 是否命中已有文件（去重） */
  deduped: boolean;
}

export function knowledgeMediaUrl(file: string): string {
  return `/api/v1/knowledge-media/${file}`;
}

/** 原名清洗：只保留安全字符，避免中文/空格/括号在 URL 与文件系统里出问题 */
export function safeImageName(original: string): string {
  const base = path.posix.basename(original.replace(/\\/g, '/'));
  const rawExt = path.extname(base).toLowerCase();
  const ext = ALLOWED_EXT.has(rawExt) ? rawExt : '';
  const stem = base
    .slice(0, base.length - path.extname(base).length)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .slice(0, 80);
  return `${stem || 'image'}${ext}`;
}

/** 是否是可展示的图片（按扩展名；内容嗅探由上传方负责） */
export function isKnowledgeImage(name: string): boolean {
  return ALLOWED_EXT.has(path.extname(name).toLowerCase());
}

export class KnowledgeMediaStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'knowledge-media');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  get root(): string {
    return this.dir;
  }

  /** 按内容哈希 + 原名落盘（同内容同原名幂等） */
  save(data: Buffer, originalName: string): SavedKnowledgeImage {
    const safe = safeImageName(originalName);
    const sha = crypto.createHash('sha1').update(data).digest('hex').slice(0, 12);
    const file = `${sha}-${safe}`;
    const abs = path.join(this.dir, file);
    const existed = fs.existsSync(abs);
    if (!existed) {
      // 先写临时文件再改名，避免中断留下半截图
      const tmp = `${abs}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, abs);
    }
    return { file, url: knowledgeMediaUrl(file), deduped: existed };
  }

  /** 文件名是否合法（白名单 + 无路径穿越） */
  isValidName(file: string): boolean {
    if (!FILE_NAME.test(file)) return false;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return false;
    return path.basename(file) === file;
  }

  /** 文件名 → 绝对路径；非法或不存在返回 null */
  resolve(file: string): string | null {
    if (!this.isValidName(file)) return null;
    const abs = path.join(this.dir, file);
    if (!abs.startsWith(this.dir + path.sep)) return null;
    return fs.existsSync(abs) ? abs : null;
  }
}
