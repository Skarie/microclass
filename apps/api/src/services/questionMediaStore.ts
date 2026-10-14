/**
 * 题目图片仓库：**内容寻址**（按 sha1 存），自动去重。
 *
 * 为什么这么设计：从题库导入的题目里，图会出现在**题干、选项、解析**三处，
 * 平均一道题 1.8 张、最多几十张；同一张图（几何图形、函数图象）经常被多道题复用。
 * 按内容哈希存盘既能自动去重，又让题面文本里的引用**提前确定**
 * （`![](/api/v1/question-media/<sha1>.png)`），不需要等题目入库拿到 id 再回写。
 *
 * 目录：`<dataDir>/uploads/question-media/<sha1 前两位>/<sha1>.<ext>`
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 允许的图片类型（与上传白名单一致：**不含 svg**，避免同源内联 XSS） */
const ALLOWED = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp']);

export interface SavedQuestionImage {
  /** 文件名，如 `a1b2….png`（题面里用它拼 URL） */
  file: string;
  /** 相对 uploads 根的路径，如 `question-media/a1/a1b2….png` */
  relPath: string;
  /** 可直接放进题面文本的 URL */
  url: string;
  /** 是否命中已有文件（去重） */
  deduped: boolean;
}

export class QuestionMediaStore {
  constructor(private readonly dataDir: string) {}

  get root(): string {
    return path.join(this.dataDir, 'uploads', 'question-media');
  }

  /** 按内容哈希落盘；类型不在白名单内返回 null（调用方跳过并记 warning） */
  save(data: Buffer): SavedQuestionImage | null {
    const ext = sniffExtension(data);
    if (!ext || !ALLOWED.has(ext)) return null;
    const sha = crypto.createHash('sha1').update(data).digest('hex');
    const file = `${sha}.${ext}`;
    const dir = path.join(this.root, sha.slice(0, 2));
    const abs = path.join(dir, file);
    const existed = fs.existsSync(abs);
    if (!existed) {
      fs.mkdirSync(dir, { recursive: true });
      // 先写临时文件再改名，避免并发/中断留下半截文件
      const tmp = `${abs}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, abs);
    }
    return {
      file,
      relPath: path.posix.join('question-media', sha.slice(0, 2), file),
      url: `/api/v1/question-media/${file}`,
      deduped: existed,
    };
  }

  /** 文件名 → 绝对路径（严格校验文件名格式，防目录穿越） */
  resolve(file: string): string | null {
    if (!/^[0-9a-f]{40}\.(png|jpe?g|gif|webp|bmp)$/i.test(file)) return null;
    const abs = path.join(this.root, file.slice(0, 2), file);
    return abs.startsWith(this.root + path.sep) && fs.existsSync(abs) ? abs : null;
  }

  /** 已存图片数量与占用（运维巡检用） */
  stats(): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    const walk = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const child = path.join(dir, e.name);
        if (e.isDirectory()) walk(child);
        else {
          files += 1;
          try {
            bytes += fs.statSync(child).size;
          } catch {
            /* 忽略 */
          }
        }
      }
    };
    walk(this.root);
    return { files, bytes };
  }
}

/** 按文件头判断图片类型 */
function sniffExtension(data: Buffer): string | null {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) return 'jpeg';
  if (data.length >= 6 && data.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return 'bmp';
  return null;
}
