/**
 * 批量导入知识点的纯函数：文件名去序号、源路径解析、课时匹配、图片引用重写。
 *
 * 素材约定（已验证）：`<科目>知识点/<册次>/<章节>/<序号 标题>.md` + 同级 `images/`；
 * md 文件名去掉 `1.1 ` 这种序号就是 lessons.title，章节目录名就是 lessons.group_name。
 * 这里不碰数据库、不读写磁盘，方便单测锁住规则。
 */
import path from 'node:path';

/**
 * 序号前缀：`1.1 ` / `2.10 ` / `3. ` / `4 ` 这类。
 * 只有在「多级序号」「数字后跟空白」「数字后跟中文顿号/句点」时才剥离，
 * 避免把 `1+1 的证明` 误伤成 `+1 的证明`。
 */
const SEQUENCE_PREFIX = /^(?:\d+(?:\.\d+)+[.、．]?\s*|\d+\s+|\d+[.、．]\s*)/;
const MD_EXT = /\.(md|markdown)$/i;
/** `![alt](ref)`，兼容 `![alt](<ref>)` 与 `![alt](ref "title")` */
const IMAGE_LINK = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

export interface LessonCandidate {
  id: number;
  title: string;
  group_name: string;
}

export interface ParsedSourcePath {
  /** 章节：有目录层级时为 md 的直接父目录名，平铺 md 为空串 */
  chapter: string;
  /** 去掉序号后的标题 */
  title: string;
  /** 是否有目录层级（决定要不要再用 H1 兜底匹配） */
  hasChapter: boolean;
}

export interface ImageRef {
  /** 原始引用（如 `./images/a.png`） */
  ref: string;
  /** 相对 md 所在目录规范化后的 zip 内路径（如 `章节/images/a.png`） */
  path: string;
}

export type LessonMatch =
  | { kind: 'matched'; lessonId: number; lessonTitle: string }
  | { kind: 'unmatched'; reason: 'no-lesson' | 'multiple-lessons' };

export function isMarkdownName(name: string): boolean {
  return MD_EXT.test(name);
}

export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

/** 跳过 macOS 打包残留与隐藏文件 */
export function isIgnoredArchivePath(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.split('/').some((part) => part.startsWith('.'));
}

/** 去掉 `3.` / `1.1 ` / `2.10 ` 这类序号前缀与 md 扩展名 */
export function stripSequencePrefix(fileName: string): string {
  return fileName.replace(MD_EXT, '').replace(SEQUENCE_PREFIX, '').trim();
}

/** zip 内路径或上传文件名 → 章节 + 标题 */
export function parseSourcePath(sourcePath: string): ParsedSourcePath {
  const clean = sourcePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter((part) => part !== '');
  const file = parts.pop() ?? clean;
  const dirs = parts;
  return {
    chapter: dirs.length > 0 ? (dirs[dirs.length - 1] ?? '') : '',
    title: stripSequencePrefix(file),
    hasChapter: dirs.length > 0,
  };
}

/** md 第一个 H1 标题（没有则空串） */
export function firstHeading(markdown: string): string {
  const m = /^\s{0,3}#\s+(.+?)\s*$/m.exec(markdown);
  return (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

/** 标题归一化：折叠空白，避免全角/半角空格造成的假不匹配 */
export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/**
 * 课时匹配：
 *  1. 先找标题完全相同的（去空白归一化）；
 *  2. 再找「包含」关系（`课时标题` 包含解析标题或反之），只在唯一命中时采用；
 *  3. 多命中 / 无命中都算失败，交给调用方进 unmatched 报告。
 */
export function matchLesson(candidates: LessonCandidate[], parsedTitle: string): LessonMatch {
  const want = normalizeTitle(parsedTitle);
  if (!want) return { kind: 'unmatched', reason: 'no-lesson' };

  const exact = candidates.filter((c) => normalizeTitle(c.title) === want);
  if (exact.length === 1) return toMatch(exact[0] as LessonCandidate);
  if (exact.length > 1) return { kind: 'unmatched', reason: 'multiple-lessons' };

  const loose = candidates.filter((c) => {
    const title = normalizeTitle(c.title);
    return title !== '' && (title.includes(want) || want.includes(title));
  });
  if (loose.length === 1) return toMatch(loose[0] as LessonCandidate);
  return { kind: 'unmatched', reason: loose.length > 1 ? 'multiple-lessons' : 'no-lesson' };
}

function toMatch(lesson: LessonCandidate): LessonMatch {
  return { kind: 'matched', lessonId: lesson.id, lessonTitle: lesson.title };
}

/** 是否绝对 URL / 站点内绝对路径 / data URI（这些不需要从 zip 里找图） */
function isExternalRef(ref: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('#');
}

/** 相对引用 → zip 内规范路径；越界（`../`）或绝对路径返回 null */
export function resolveImagePath(mdPath: string, ref: string): string | null {
  const rawRef = ref.replace(/^<|>$/g, '');
  if (isExternalRef(rawRef)) return null;
  let decoded = rawRef.split('#')[0] ?? rawRef;
  decoded = decoded.split('?')[0] ?? decoded;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* 非法的 %xx 保留原样 */
  }
  const mdDir = path.posix.dirname(mdPath.replace(/\\/g, '/'));
  const joined = path.posix.normalize(path.posix.join(mdDir === '.' ? '' : mdDir, decoded));
  if (joined === '..' || joined.startsWith('../') || joined.startsWith('/')) return null;
  return joined.replace(/^\.\//, '');
}

/** 收集 md 里所有「相对路径」图片引用（按规范化路径去重，保持出现顺序） */
export function collectImageRefs(markdown: string, mdPath: string): ImageRef[] {
  const seen = new Map<string, ImageRef>();
  for (const m of markdown.matchAll(IMAGE_LINK)) {
    const ref = m[2] ?? '';
    const resolved = resolveImagePath(mdPath, ref);
    if (resolved && !seen.has(resolved)) seen.set(resolved, { ref, path: resolved });
  }
  return [...seen.values()];
}

export interface RewriteResult {
  content: string;
  /** 成功改写（找到了图片）的引用次数 */
  images: number;
  /** 未找到、保留原路径的引用次数 */
  missingImages: number;
}

/**
 * 把 `![alt](images/a.png)` 改写成 `![alt](/api/v1/knowledge-media/<文件名>)`。
 * `urlOf` 返回 null 表示图片缺失：保留原路径并计入 missingImages。
 */
export function rewriteImageLinks(
  markdown: string,
  mdPath: string,
  urlOf: (zipPath: string) => string | null,
): RewriteResult {
  let images = 0;
  let missingImages = 0;
  const content = markdown.replace(IMAGE_LINK, (full, alt: string, ref: string) => {
    const resolved = resolveImagePath(mdPath, ref);
    if (!resolved) return full;
    const url = urlOf(resolved);
    if (url === null) {
      missingImages += 1;
      return full;
    }
    images += 1;
    return `![${alt}](${url})`;
  });
  return { content, images, missingImages };
}

/** dryRun 预览用的占位 URL（不落盘，只用于估算正文字符数） */
export function previewMediaUrl(zipPath: string): string {
  const base = zipPath.split('/').pop() ?? 'image';
  return `/api/v1/knowledge-media/${base}`;
}
