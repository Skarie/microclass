/**
 * 题目配图：把 `题目.md` 里 `![题目图片](images/xxx.png)` 的相对引用
 * 落到题图仓库（内容寻址，与网页上传同一条路径），并改写成可访问 URL。
 *
 * dry-run 只算 URL 不落盘（`previewQuestionImage`），因此统计结果与正式导入一致。
 * 找不到的图片**保留原相对路径**并计数，不阻断导入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { previewQuestionImage, type QuestionMediaStore } from './questionMediaStore.js';

/** 正文里的图片引用（只认 `images/…` 相对路径，外链原样保留） */
const IMAGE_REF = /!\[([^\]]*)\]\((images\/[^)\s]+)\)/g;

export interface TeacherImageHit {
  /** 可直接放进题面的 URL */
  url: string;
  /** 相对 uploads 根的存储路径（写 `questions.image_path`） */
  relPath: string;
}

/**
 * 单个册次导入期间的图片解析器：同一个文件只读一次、同一张图只存一次
 * （同一道题的题干与解析经常引用同一张图）。
 */
export class TeacherImageResolver {
  private readonly cache = new Map<string, TeacherImageHit | null>();
  private readonly missing = new Set<string>();
  private readonly relPaths = new Map<string, string>();

  constructor(
    private readonly media: QuestionMediaStore,
    private readonly dryRun: boolean,
  ) {}

  /** 相对引用 → 线上图片；读不到文件或类型不在白名单内返回 null */
  resolve(ref: string, baseDir: string): TeacherImageHit | null {
    const abs = path.resolve(baseDir, ref);
    const cached = this.cache.get(abs);
    if (cached !== undefined) return cached;
    let hit: TeacherImageHit | null = null;
    try {
      const data = fs.readFileSync(abs);
      const saved = this.dryRun ? previewQuestionImage(data) : this.media.save(data);
      if (saved) {
        hit = { url: saved.url, relPath: saved.relPath };
        this.relPaths.set(saved.url, saved.relPath);
      }
    } catch {
      hit = null;
    }
    if (!hit) this.missing.add(abs);
    this.cache.set(abs, hit);
    return hit;
  }

  /** 缺失图片数（按文件去重） */
  get missingCount(): number {
    return this.missing.size;
  }

  /** 题图 URL → uploads 相对路径（写 `image_path`，旧视图/Word 导出按它取图） */
  relPathOf(url: string): string | undefined {
    return this.relPaths.get(url);
  }
}

/** 改写一段正文里的图片引用（找不到的保持原样） */
export function rewriteTeacherImageRefs(text: string, baseDir: string, resolver: TeacherImageResolver): string {
  if (text === '' || !text.includes('images/')) return text;
  return text.replace(IMAGE_REF, (whole: string, alt: string, ref: string) => {
    const hit = resolver.resolve(ref, baseDir);
    return hit ? `![${alt}](${hit.url})` : whole;
  });
}
